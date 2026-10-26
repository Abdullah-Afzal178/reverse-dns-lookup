import "server-only";

import { Resolver } from "node:dns/promises";

import { readAnatomy, type Anatomy } from "@/lib/anatomy";
import { MAX_BULK } from "@/lib/input";
import { canonicalIp, isMulticastV4, isNonPublicIp, reverseName } from "@/lib/ip";
import { mapWithLimit, withDeadline } from "@/lib/pool";
import { getSessionCache, setSessionCache } from "@/lib/session-cache";
import {
  checkIdentity,
  chooseHostname,
  combineFamilies,
  describeDnsError,
  finalSource,
  isDefinitive,
  pickBest,
  normalizePtr,
  verdictFor,
  type CandidateResult,
  type FamilyAnswer,
  type ForwardResult,
  type HostnameChoice,
  type IdentityCheck,
  type LiveReverse,
  type Verdict,
} from "@/lib/verify";

const GEO_ENDPOINT = "https://api.ipgeolocation.io/v3/ipgeo";
const BULK_ENDPOINT = "https://api.ipgeolocation.io/v3/ipgeo-bulk";

/**
 * The stored hostname only. "hostnameFallbackLive" adds the API's own live
 * PTR query, but it runs those one after another: measured on 42 addresses it
 * had never seen, the bulk call took 42 seconds against 0.4 with "hostname".
 * The live half is done here instead, in parallel and under a deadline — and
 * only for addresses whose stored name is missing or does not check out.
 */
const HOSTNAME_MODE = "hostname";

/** The whole request — API call plus every DNS query — finishes inside this. */
const REQUEST_BUDGET_MS = 12_000;
const API_TIMEOUT_MS = 8_000;

/**
 * Every address in a full list starts at once. DNS queries are cheap; what
 * costs time is queueing. With a smaller pool, quick answers sat behind slow,
 * unresponsive reverse zones until the deadline cut them off — measured at 25
 * of 50 rows on a cold list, most of which answered instantly when asked alone.
 */
const CONCURRENCY = MAX_BULK;

/** A hostname with more addresses than this is listed, not exhaustively checked. */
export const MAX_FORWARD_ADDRESSES = 8;

export type NetworkContext = {
  asNumber: string;
  organization: string;
  asnType: string;
  city: string;
  region: string;
  country: string;
  flag: string;
};

export type ReverseResult = {
  ip: string;
  hostname: string | null;
  /** Where the hostname came from — see HostnameChoice in lib/verify.ts. */
  source: HostnameChoice["source"];
  /** ipgeolocation.io's stored name, when live DNS no longer publishes it. */
  storedHostname: string | null;
  /**
   * What ipgeolocation.io has stored for the address, exactly — null both when
   * it has nothing and when it could not be asked (see apiProblem). The page
   * must never infer "the API had no name" from storedHostname, which is also
   * null when the stored name is current or merely lost to another PTR name.
   */
  apiHostname: string | null;
  /** The address's other PTR names that were checked, each with its own verdict. */
  alternatives: CandidateResult[];
  /** PTR names the address publishes beyond the ones checked. */
  omittedNames: number;
  /** Null when there was no hostname to resolve. */
  forward: ForwardResult | null;
  verdict: Verdict;
  identity: IdentityCheck;
  anatomy: Anatomy | null;
  network: NetworkContext | null;
  /** Set when this address could not be looked up at all. */
  error: string | null;
  /** Set when the API could not help and the result rests on live DNS alone. */
  apiProblem: string | null;
};

export type HostnameReport = {
  hostname: string;
  forward: ForwardResult;
  results: ReverseResult[];
  /** Addresses past MAX_FORWARD_ADDRESSES, counted rather than dropped silently. */
  unchecked: number;
};

type ApiRecord = {
  hostname: string | null;
  network: NetworkContext | null;
  /** A hard stop: the address cannot be looked up at all (private, reserved). */
  error: string | null;
  /**
   * The API could not help with this address — slow, down, or the key was
   * refused. Not a stop: live DNS still answers the question, just without
   * the stored fallback or the network details.
   */
  apiProblem: string | null;
};

const soft = (apiProblem: string): ApiRecord => ({ hostname: null, network: null, error: null, apiProblem });
const hard = (error: string): ApiRecord => ({ hostname: null, network: null, error, apiProblem: null });

/**
 * Resolvers the retry goes to. Measured on cold lists of 50: of the lookups a
 * local resolver gave up on, 11 of 26 answered at once at 1.1.1.1 — the local
 * path was dropping queries under load, not the zones failing. Set
 * DNS_RETRY_SERVERS to change them, or to an empty string to retry locally.
 */
const RETRY_SERVERS = validServers(process.env.DNS_RETRY_SERVERS ?? "1.1.1.1,8.8.8.8");

/**
 * setServers() throws on an entry it cannot parse ("1.1.1.1#53", a hostname),
 * and an unchecked typo here would take down every lookup. Bad entries are
 * dropped with a warning; with none left, retries use the system resolver.
 */
export function validServers(list: string): string[] {
  const valid: string[] = [];

  for (const entry of list.split(",").map((server) => server.trim()).filter(Boolean)) {
    try {
      new Resolver().setServers([entry]);
      valid.push(entry);
    } catch {
      console.warn(`DNS_RETRY_SERVERS: ignoring "${entry}", which is not an IP address or IP:port.`);
    }
  }

  return valid;
}

function resolver(servers: string[] = []) {
  // One try per query, with our own single retry on top (see query()). c-ares
  // overshoots its timeout by up to half again, so 1500 ms means about 2.2 s
  // per attempt — and "tries: 2" would have doubled it on the retry.
  const dns = new Resolver({ timeout: 1500, tries: 1 });

  if (servers.length > 0) {
    dns.setServers(servers);
  }

  return dns;
}

/**
 * One DNS query: first through the system resolver, then — only on a
 * transient failure — once more through a public one. A definitive answer
 * (no such name, no records) is never retried.
 */
async function query(run: (dns: Resolver) => Promise<string[]>, deadline: number): Promise<FamilyAnswer> {
  let code: string | undefined;

  for (const servers of [[], RETRY_SERVERS]) {
    // The answer could no longer be used, so do not ask.
    if (Date.now() >= deadline) {
      return { ok: false, code: code ?? "EDEADLINE" };
    }

    try {
      return { ok: true, addresses: await run(resolver(servers)) };
    } catch (error) {
      code = (error as NodeJS.ErrnoException | undefined)?.code;

      if (isDefinitive(code)) {
        break;
      }
    }
  }

  return { ok: false, code };
}

/** Both families: an IPv4 PTR name may only have AAAA records, and vice versa. */
export async function forwardResolve(hostname: string, deadline: number): Promise<ForwardResult> {
  const [v4, v6] = await Promise.all([
    query((dns) => dns.resolve4(hostname), deadline),
    query((dns) => dns.resolve6(hostname), deadline),
  ]);
  const result = combineFamilies(v4, v6);

  if (result.status !== "resolved") {
    return result;
  }

  // The system resolver may know internal zones. Their addresses are never
  // shown — they cannot match a public address anyway — only counted.
  const visible = result.addresses.filter((address) => !isNonPublicIp(address));

  return { ...result, addresses: visible, hidden: result.addresses.length - visible.length };
}

/**
 * The PTR names live DNS publishes for the address right now. Queried as a
 * PTR record directly: dns.reverse() reports a timeout, SERVFAIL and REFUSED
 * all as ENOTFOUND, which would turn every DNS hiccup into "no PTR record".
 */
async function liveReverse(ip: string, deadline: number): Promise<LiveReverse> {
  const name = reverseName(ip);

  if (!name) {
    return { status: "failed" };
  }

  const answer = await query((dns) => dns.resolvePtr(name), deadline);

  if (!answer.ok) {
    return isDefinitive(answer.code) ? { status: "none" } : { status: "failed" };
  }

  const names = answer.addresses.map((name) => normalizePtr(name, ip)).filter((name): name is string => name !== null);

  return { status: "names", names: [...new Set(names)] };
}

/** What finish() has established so far, so a timed-out row keeps it. */
type Progress = {
  record?: ApiRecord;
  live?: LiveReverse;
  storedForward?: ForwardResult | null;
  choice?: HostnameChoice;
  /** Every candidate name whose forward check has completed. */
  checked: CandidateResult[];
};

async function finish(
  ip: string,
  recordReady: Promise<ApiRecord>,
  progress: Progress,
  deadline: number,
): Promise<ReverseResult> {
  if (isNonPublicIp(ip)) {
    return failure(ip, nonPublicMessage(ip));
  }

  // The live PTR query does not need the API, so the two run side by side
  // rather than one queueing behind a call measured taking 32 seconds.
  const [liveAnswer, record] = await Promise.all([
    liveReverse(ip, deadline).then((answer) => (progress.live = answer)),
    recordReady.then((answer) => (progress.record = answer)),
  ]);

  if (record.error) {
    return failure(ip, record.error);
  }

  const stored = record.hostname;

  // The stored name's forward check starts at once, alongside the live PTR
  // query — when the two agree, which is most of the time, it is already done.
  // It is only waited for if that name is actually the one being checked.
  // The catch is belt and braces: forwardResolve is written never to reject.
  const storedForward = stored
    ? forwardResolve(stored, deadline)
        .then((answer) => (progress.storedForward = answer))
        .catch((): ForwardResult => ({ status: "failed", reason: describeDnsError(undefined), transient: true }))
    : null;

  const choice = (progress.choice = chooseHostname(stored, liveAnswer));

  // Decided by live DNS alone — e.g. a definite "no PTR" — without waiting on
  // a stored name that is no longer relevant.
  if (choice.candidates.length === 0) {
    return assemble(ip, record, null, null, choice.unknown ? "inconclusive" : "none", null, choice.storedHostname, []);
  }

  const check = async (name: string): Promise<CandidateResult> => {
    const answer = name === stored && storedForward ? await storedForward : await forwardResolve(name, deadline);
    const result = { name, forward: answer, verdict: verdictFor(name, answer, ip) };

    progress.checked.push(result);

    return result;
  };

  const [first, ...rest] = choice.candidates;
  const results = [await check(first)];

  // A host can publish several PTR names. Unless the first confirms, every
  // one is checked, and they are ranked rather than taken in DNS order.
  if (results[0].verdict !== "confirmed" && rest.length > 0) {
    results.push(...(await Promise.all(rest.map(check))));
  }

  const best = pickBest(results) as CandidateResult;
  const { source, storedHostname } = finalSource(choice, best.name, stored);
  // Names past the cap were never checked: without a confirmation, one of
  // them might still be the one that points back, so nothing is settled.
  const verdict = best.verdict !== "confirmed" && choice.omitted > 0 ? "inconclusive" : best.verdict;

  return assemble(
    ip,
    record,
    best.name,
    best.forward,
    verdict,
    source,
    storedHostname,
    results.filter((result) => result !== best),
    choice.omitted,
  );
}

function assemble(
  ip: string,
  record: ApiRecord,
  hostname: string | null,
  forward: ForwardResult | null,
  verdict: Verdict,
  source: ReverseResult["source"],
  storedHostname: string | null,
  alternatives: CandidateResult[],
  omittedNames = 0,
): ReverseResult {
  return {
    ip,
    hostname,
    source: hostname ? source : null,
    storedHostname,
    apiHostname: record.hostname,
    alternatives,
    omittedNames,
    forward,
    verdict,
    identity: checkIdentity(hostname, verdict, hostname ? source : null),
    anatomy: hostname ? readAnatomy(hostname, ip) : null,
    network: record.network,
    error: null,
    apiProblem: record.apiProblem,
  };
}

/**
 * The row for an address whose checks ran out of time. It keeps whatever DNS
 * had already said, so a timed-out row never shows a stale stored name, never
 * claims DNS was silent when it had answered, and never lets one failed name
 * decide the verdict while another was still being checked.
 */
function outOfTime(ip: string, progress: Progress): ReverseResult {
  if (isNonPublicIp(ip)) {
    return failure(ip, nonPublicMessage(ip));
  }

  const record = progress.record ?? soft(API_UNAVAILABLE);

  if (record.error) {
    return failure(ip, record.error);
  }

  const late: ForwardResult = { status: "failed", reason: describeDnsError("EDEADLINE"), transient: true };
  const stored = record.hostname;
  // If live DNS answered, its answer decides, even if finish() never got as
  // far as recording the choice.
  const choice = progress.choice ?? (progress.live ? chooseHostname(stored, progress.live) : undefined);

  if (choice) {
    if (choice.candidates.length === 0) {
      return assemble(ip, record, null, null, choice.unknown ? "inconclusive" : "none", null, choice.storedHostname, []);
    }

    const checked = progress.checked.filter((result) => choice.candidates.includes(result.name));
    const best = pickBest(checked);

    // A confirmation is a full answer, whatever else was still running.
    if (best?.verdict === "confirmed") {
      const { source, storedHostname } = finalSource(choice, best.name, stored);

      return assemble(ip, record, best.name, best.forward, "confirmed", source, storedHostname, checked.filter((r) => r !== best));
    }

    // Otherwise a name still unchecked leaves the question open.
    const pending = choice.candidates.find((name) => !checked.some((result) => result.name === name));

    if (pending) {
      const { source, storedHostname } = finalSource(choice, pending, stored);

      return assemble(ip, record, pending, late, "inconclusive", source, storedHostname, checked);
    }

    // Everything was checked; finish() just had not returned yet.
    const settled = best as CandidateResult;
    const { source, storedHostname } = finalSource(choice, settled.name, stored);

    return assemble(ip, record, settled.name, settled.forward, settled.verdict, source, storedHostname, checked.filter((r) => r !== settled));
  }

  // Live DNS had not answered: the stored name stands in, checked if possible.
  if (stored) {
    const forward = progress.storedForward ?? late;

    return assemble(ip, record, stored, forward, verdictFor(stored, forward, ip), "ipgeolocation", null, []);
  }

  return assemble(ip, record, null, null, "inconclusive", null, null, []);
}

function failure(ip: string, error: string): ReverseResult {
  return {
    ip,
    hostname: null,
    source: null,
    storedHostname: null,
    apiHostname: null,
    alternatives: [],
    omittedNames: 0,
    forward: null,
    verdict: "none",
    identity: null,
    anatomy: null,
    network: null,
    error,
    apiProblem: null,
  };
}

export async function reverseOne(rawIp: string): Promise<ReverseResult> {
  const [result] = await reverseMany([rawIp]);

  return result;
}

export async function reverseMany(rawIps: string[], deadline = Date.now() + REQUEST_BUDGET_MS): Promise<ReverseResult[]> {
  const ips = rawIps.map((ip) => canonicalIp(ip) ?? ip);
  // Started, not awaited: every address's live DNS work begins alongside it.
  const records = ips.length === 1 ? fetchOne(ips[0], deadline).then((one) => [one]) : fetchMany(ips, deadline);

  return mapWithLimit(ips, CONCURRENCY, (ip, index) => {
    const progress: Progress = { checked: [] };

    return withDeadline(
      () => finish(ip, records.then((all) => all[index]), progress, deadline),
      deadline,
      () => outOfTime(ip, progress),
    );
  });
}

/**
 * Time kept back from the API for the forward checks that follow it, so a
 * slow API degrades to "live DNS only" instead of using up the whole request.
 */
const DNS_RESERVE_MS = 3_500;

/** The API's own timeout: never past the point where DNS could still finish. */
function apiSignal(deadline: number) {
  const available = deadline - Date.now() - DNS_RESERVE_MS;

  return AbortSignal.timeout(Math.max(250, Math.min(API_TIMEOUT_MS, available)));
}

/**
 * The round trip from the other end: a name's addresses, the PTR of each,
 * and whether that PTR resolves back. Point it at a server that sends mail,
 * and this is the check a receiving mail server runs against it.
 */
export async function reverseHostname(hostname: string, deadline = Date.now() + REQUEST_BUDGET_MS): Promise<HostnameReport> {
  const forward = await withDeadline(
    () => forwardResolve(hostname, deadline),
    deadline,
    (): ForwardResult => ({ status: "failed", reason: describeDnsError("EDEADLINE"), transient: true }),
  );

  if (forward.status === "failed") {
    return { hostname, forward, results: [], unchecked: 0 };
  }

  const unique = [...new Set(forward.addresses.map((address) => canonicalIp(address) ?? address))];
  const checked = unique.slice(0, MAX_FORWARD_ADDRESSES);

  return {
    hostname,
    forward,
    results: checked.length > 0 ? await reverseMany(checked, deadline) : [],
    unchecked: unique.length - checked.length,
  };
}

const MULTICAST_NOTE =
  "ipgeolocation.io has no data for multicast addresses, so this result comes from live DNS alone.";

/** The API's word that an address is reserved. Live DNS may still know better. */
const API_RESERVED =
  "ipgeolocation.io treats this as a reserved address and has no data for it, so this result comes from live DNS alone.";

async function fetchOne(ip: string, deadline: number): Promise<ApiRecord> {
  if (isNonPublicIp(ip)) {
    return hard(nonPublicMessage(ip));
  }

  if (isMulticastV4(ip)) {
    return soft(MULTICAST_NOTE);
  }

  const cacheKey = `ptr:${ip}`;
  const cached = getSessionCache<ApiRecord>(cacheKey);

  if (cached) {
    return cached;
  }

  const apiKey = process.env.IPGEOLOCATION_API_KEY;

  if (!apiKey) {
    return missingKey();
  }

  const params = new URLSearchParams({
    apiKey,
    ip,
    include: `${HOSTNAME_MODE},network`,
    fields: "hostname,asn,location",
  });

  try {
    const response = await fetch(`${GEO_ENDPOINT}?${params.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: apiSignal(deadline),
    });
    const payload = (await safeJson(response)) as Record<string, unknown> | null;

    if (response.status === 423) {
      // Only our own check makes an address a hard stop. The API also says
      // "bogon" for some globally routed ranges (AS112, for one) that have
      // real PTR records, so its answer just means "no API data".
      return soft(API_RESERVED);
    }

    if (!response.ok || !payload) {
      return soft(apiError(response.status, payload));
    }

    const record = toRecord(payload, ip);
    setSessionCache(cacheKey, record);


    return record;
  } catch {
    return soft(API_UNAVAILABLE);
  }
}

async function fetchMany(ips: string[], deadline: number): Promise<ApiRecord[]> {
  const records: (ApiRecord | null)[] = ips.map((ip) =>
    isNonPublicIp(ip)
      ? hard(nonPublicMessage(ip))
      : isMulticastV4(ip)
        ? soft(MULTICAST_NOTE)
        : getSessionCache<ApiRecord>(`ptr:${ip}`),
  );

  const pending = ips.map((ip, index) => ({ ip, index })).filter(({ index }) => records[index] === null);

  if (pending.length === 0) {
    return records as ApiRecord[];
  }

  const apiKey = process.env.IPGEOLOCATION_API_KEY;

  if (!apiKey) {
    return records.map((record) => record ?? missingKey());
  }

  const params = new URLSearchParams({
    apiKey,
    include: `${HOSTNAME_MODE},network`,
    fields: "hostname,asn,location",
  });

  const fail = (problem: string) => records.map((record) => record ?? soft(problem));

  try {
    const response = await fetch(`${BULK_ENDPOINT}?${params.toString()}`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ips: pending.map(({ ip }) => ip) }),
      signal: apiSignal(deadline),
    });
    const payload = await safeJson(response);

    if (!response.ok || !Array.isArray(payload)) {
      return fail(apiError(response.status, payload as Record<string, unknown> | null));
    }

    // Results are positional. A failed entry is {message} with no ip field,
    // and IPv6 comes back expanded, so the index is the only safe join key.
    pending.forEach(({ ip, index }, position) => {
      const item = payload[position] as Record<string, unknown> | undefined;

      if (!item || typeof item !== "object" || "message" in item) {
        const message = typeof item?.message === "string" ? item.message : "";

        records[index] = /bogon/i.test(message)
          ? soft(API_RESERVED)
          : soft(message || "ipgeolocation.io returned no result for this address.");
        return;
      }

      const record = toRecord(item, ip);
      setSessionCache(`ptr:${ip}`, record);
      records[index] = record;
    });

    return fail("ipgeolocation.io returned no result for this address.");
  } catch {
    return fail(API_UNAVAILABLE);
  }
}

function toRecord(payload: Record<string, unknown>, ip: string): ApiRecord {
  const asn = asObject(payload.asn);
  const location = asObject(payload.location);

  return {
    hostname: normalizePtr(payload.hostname, ip),
    network: {
      asNumber: clean(asn?.as_number),
      organization: clean(asn?.organization),
      asnType: clean(asn?.type),
      city: clean(location?.city),
      region: clean(location?.state_prov),
      country: clean(location?.country_name),
      flag: clean(location?.country_emoji),
    },
    error: null,
    apiProblem: null,
  };
}

function nonPublicMessage(ip: string) {
  return `${ip} is a private or reserved address. It has no public reverse DNS; only your own network's resolver could answer for it.`;
}

function missingKey(): ApiRecord {
  return soft("IPGEOLOCATION_API_KEY is not set, so this result comes from live DNS alone.");
}

const API_UNAVAILABLE = "ipgeolocation.io did not answer in time, so this result comes from live DNS alone.";

function apiError(status: number, payload: Record<string, unknown> | null) {
  if (status === 401 || status === 403) {
    return "ipgeolocation.io refused the API key, so this result comes from live DNS alone. Check IPGEOLOCATION_API_KEY.";
  }

  if (status === 429) {
    return "The ipgeolocation.io lookup limit was reached, so this result comes from live DNS alone.";
  }

  const message = typeof payload?.message === "string" ? payload.message : "";

  return `ipgeolocation.io could not help (${message || `status ${status}`}), so this result comes from live DNS alone.`;
}

/** The API uses "??" and "Unknown" where it has no value. */
function clean(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";

  return text === "??" || text === "Unknown" ? "" : text;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
