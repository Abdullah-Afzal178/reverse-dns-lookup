/**
 * Turns a PTR answer and a forward lookup into a verdict. Pure.
 *
 * The idea is forward-confirmed reverse DNS (FCrDNS). Anyone who controls an
 * IP can make its PTR record say anything — "crawl-1.googlebot.com" included.
 * What they cannot do is make googlebot.com's own DNS point back at their IP.
 * So a reverse answer is only trustworthy once the name resolves back to the
 * same address.
 */

import { isIp, isIpv4, sameIp } from "@/lib/ip";

/** One address family's answer, as the resolver gave it. */
export type FamilyAnswer = { ok: true; addresses: string[] } | { ok: false; code: string | undefined };

export type ForwardResult =
  | {
      status: "resolved";
      addresses: string[];
      /** Families whose lookup failed for a transient reason, so their absence proves nothing. */
      failedFamilies: ("v4" | "v6")[];
      /**
       * Private, loopback or internal addresses the name also resolved to.
       * Counted, never shown: the server's own resolver may know internal
       * zones, and a public page must not become a way to list them.
       */
      hidden?: number;
    }
  | { status: "failed"; reason: string; transient: boolean };

/**
 * "confirmed"    the name resolves back to the address
 * "mismatch"     the name resolves, but not to this address
 * "unresolvable" DNS says the name does not exist or has no addresses
 * "inconclusive" the lookup itself failed — this says nothing about the record
 * "none"         no PTR record is published
 */
export type Verdict = "confirmed" | "mismatch" | "unresolvable" | "inconclusive" | "none";

/** Answers that are facts about the name. Anything else is the lookup failing. */
const DEFINITIVE_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export function isDefinitive(code: string | undefined) {
  return code !== undefined && DEFINITIVE_CODES.has(code);
}

/**
 * Merges the A and AAAA answers. A missing family only counts as "no records"
 * when DNS said so. A timeout or refusal on one family must not be read as
 * "this name has no IPv4 address" — that turns a lost packet into a false
 * "does not point back".
 */
export function combineFamilies(v4: FamilyAnswer, v6: FamilyAnswer): ForwardResult {
  const addresses = [...(v4.ok ? v4.addresses : []), ...(v6.ok ? v6.addresses : [])];
  const failedFamilies: ("v4" | "v6")[] = [];

  if (!v4.ok && !isDefinitive(v4.code)) failedFamilies.push("v4");
  if (!v6.ok && !isDefinitive(v6.code)) failedFamilies.push("v6");

  if (v4.ok || v6.ok) {
    return { status: "resolved", addresses, failedFamilies };
  }

  const codes = [v4, v6].map((answer) => (answer.ok ? undefined : answer.code));

  // NXDOMAIN is a statement about the name, not one record type: if either
  // query says the name does not exist, it does not exist for the other one
  // either, whatever went wrong with that query.
  if (codes.some((code) => code === "ENOTFOUND" || code === "NXDOMAIN")) {
    return { status: "failed", reason: describeDnsError("ENOTFOUND"), transient: false };
  }

  if (codes.every((code) => code === "ENODATA")) {
    return { status: "failed", reason: describeDnsError("ENODATA"), transient: false };
  }

  const transientCode = codes.find((code) => code !== "ENODATA");

  return { status: "failed", reason: describeDnsError(transientCode), transient: true };
}

/** What a live PTR query for the address returned. */
export type LiveReverse =
  | { status: "names"; names: string[] }
  | { status: "none" }
  | { status: "failed" };

export type HostnameChoice = {
  /** Names to forward-check, best first. Empty when there is no PTR to check. */
  candidates: string[];
  /**
   * "agree": live DNS publishes the name ipgeolocation.io has stored.
   * "live":  live DNS publishes a name ipgeolocation.io does not have.
   * "ipgeolocation": live DNS did not answer, so the stored name stands in.
   */
  source: "agree" | "live" | "ipgeolocation" | null;
  /** A stored name worth mentioning because live DNS disagrees with it. */
  storedHostname: string | null;
  /** True when nothing answered at all, so "no PTR" is not established. */
  unknown: boolean;
  /** Live PTR names past MAX_PTR_CANDIDATES, never checked. */
  omitted: number;
};

/**
 * PTR names forward-checked per address. They run in parallel under the
 * request deadline; the cap only bites on the rare host that publishes dozens.
 */
export const MAX_PTR_CANDIDATES = 10;

/**
 * Live DNS is the source of truth whenever it answers: the PTR record is
 * whatever is published right now. The stored record covers the common case
 * where a live query times out, and is shown alongside when the two differ.
 */
export function chooseHostname(stored: string | null, live: LiveReverse): HostnameChoice {
  if (live.status === "names" && live.names.length > 0) {
    const agree = stored !== null && live.names.includes(stored);
    // Keep the agreed name first, so the common case checks one name.
    const ordered = agree ? [stored, ...live.names.filter((name) => name !== stored)] : live.names;

    return {
      candidates: ordered.slice(0, MAX_PTR_CANDIDATES),
      source: agree ? "agree" : "live",
      storedHostname: agree ? null : stored,
      unknown: false,
      omitted: Math.max(0, ordered.length - MAX_PTR_CANDIDATES),
    };
  }

  if (live.status === "none" || (live.status === "names" && live.names.length === 0)) {
    // No PTR is published now. A stored name is history, not an answer.
    return { candidates: [], source: null, storedHostname: stored, unknown: false, omitted: 0 };
  }

  return {
    candidates: stored ? [stored] : [],
    source: stored ? "ipgeolocation" : null,
    storedHostname: null,
    unknown: stored === null,
    omitted: 0,
  };
}

/**
 * The API answers "no hostname" by echoing the IP back — sometimes in the
 * expanded IPv6 spelling the bulk endpoint uses. Both mean "none".
 */
export function normalizePtr(raw: unknown, ip: string): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const text = raw.trim().toLowerCase().replace(/\.$/, "");

  if (text === "" || text === "??" || text === "unknown") {
    return null;
  }

  if (isIp(text) || sameIp(text, ip)) {
    return null;
  }

  return text;
}

export function verdictFor(hostname: string | null, forward: ForwardResult | null, ip: string): Verdict {
  if (!hostname) {
    return "none";
  }

  if (!forward) {
    return "inconclusive";
  }

  if (forward.status === "failed") {
    return forward.transient ? "inconclusive" : "unresolvable";
  }

  if (forward.addresses.some((address) => sameIp(address, ip))) {
    return "confirmed";
  }

  // The address's own family failed, so its absence from the answer is noise.
  const family = isIpv4(ip) ? "v4" : "v6";

  return forward.failedFamilies.includes(family) ? "inconclusive" : "mismatch";
}

/** Plain-language reasons. Only the definitive codes describe the record itself. */
export function describeDnsError(code: string | undefined): string {
  switch (code) {
    case "ENOTFOUND":
    case "NXDOMAIN":
      return "The name does not exist in DNS.";
    case "ENODATA":
      return "The name exists but has no address records.";
    case "ETIMEOUT":
    case "ETIMEDOUT":
      return "The DNS lookup timed out. That says nothing about the record, so try again.";
    case "ESERVFAIL":
      return "The DNS lookup failed (SERVFAIL). The name's servers may be broken, or it may be temporary, so try again.";
    case "EREFUSED":
    case "ECONNREFUSED":
      return "The lookup was refused on the checking side, not by the record, so try again.";
    case "EDEADLINE":
      return "The check ran out of time before DNS answered. Try again, on its own if it was part of a long list.";
    default:
      return "The DNS lookup failed. Try again.";
  }
}

/* ------------------------------------------------------------------------ */
/* Who the name belongs to                                                  */
/* ------------------------------------------------------------------------ */

export type Operator = { name: string; zones: string[] };

export type Crawler = {
  name: string;
  operator: string;
  /** The hostname shapes the operator documents for this crawler specifically. */
  patterns: RegExp[];
  /**
   * The operator publishes some of these names with no forward record, and
   * verifies them by its published IP list instead — which this tool does not
   * fetch. A name that does not exist is then unverified, never fake.
   */
  forwardOptional?: boolean;
};

/**
 * Domains an operator controls. A forward-confirmed name here proves the
 * address belongs to that operator — and nothing more. Gmail's outbound mail
 * servers live under google.com; they are Google's, but they are not Googlebot.
 */
export const OPERATORS: Operator[] = [
  // Not gae.googleusercontent.com: Google documents those addresses as
  // fetching on behalf of Google Cloud customers, so a confirmed name there
  // does not prove the traffic is Google's own.
  { name: "Google", zones: ["googlebot.com", "google.com", "1e100.net"] },
  { name: "Microsoft", zones: ["search.msn.com"] },
  { name: "Apple", zones: ["applebot.apple.com"] },
  { name: "Yandex", zones: ["yandex.ru", "yandex.net", "yandex.com"] },
  { name: "Baidu", zones: ["baidu.com", "baidu.jp"] },
  { name: "Yahoo", zones: ["crawl.yahoo.net"] },
  { name: "Amazon", zones: ["crawl.amazonbot.amazon"] },
  { name: "Ahrefs", zones: ["ahrefs.com", "ahrefs.net"] },
];

/**
 * Crawler-specific hostnames, per each operator's verification docs, under
 * the names the operators use. Google documents three kinds, and only one of
 * them is Googlebot:
 *   common crawlers (Googlebot)   crawl-*.googlebot.com, geo-crawl-*.geo.googlebot.com
 *   special-case crawlers         rate-limited-proxy-*.google.com
 *   user-triggered fetchers       google-proxy-*.google.com, *.gae.googleusercontent.com
 * The App Engine names are left out entirely: Google says they can fetch on
 * behalf of Google Cloud customers, so "verified" would certify anyone's app.
 * Also not here: bare google.com (Gmail's mail servers live there) and
 * bc.googleusercontent.com (every Google Cloud customer VM).
 */
export const CRAWLERS: Crawler[] = [
  { name: "Googlebot", operator: "Google", patterns: [/(^|\.)googlebot\.com$/] },
  { name: "Google special-case crawler", operator: "Google", patterns: [/^rate-limited-proxy-[0-9a-f-]+\.google\.com$/] },
  // Google's own reverse zones publish google-proxy-* names for whole ranges in
  // its user-triggered-agents list that have no forward record at all; Google
  // verifies those against the published list. So a missing name is not proof.
  {
    name: "Google user-triggered fetcher",
    operator: "Google",
    patterns: [/^google-proxy-[0-9a-f-]+\.google\.com$/],
    forwardOptional: true,
  },
  { name: "Bingbot", operator: "Microsoft", patterns: [/\.search\.msn\.com$/] },
  { name: "Applebot", operator: "Apple", patterns: [/\.applebot\.apple\.com$/] },
  { name: "YandexBot", operator: "Yandex", patterns: [/^spider-[0-9a-f-]+\.yandex\.(ru|net|com)$/, /\.spider\.yandex\.(ru|net|com)$/] },
  { name: "Baiduspider", operator: "Baidu", patterns: [/\.crawl\.baidu\.(com|jp)$/] },
  { name: "Yahoo Slurp", operator: "Yahoo", patterns: [/\.crawl\.yahoo\.net$/] },
  { name: "Amazonbot", operator: "Amazon", patterns: [/\.crawl\.amazonbot\.amazon$/] },
];

/** Matches on a label boundary: "evilgooglebot.com" is not googlebot.com. */
export function hasSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function crawlerFor(hostname: string | null): Crawler | null {
  if (!hostname) {
    return null;
  }

  return CRAWLERS.find((crawler) => crawler.patterns.some((pattern) => pattern.test(hostname))) ?? null;
}

export function operatorFor(hostname: string | null): Operator | null {
  if (!hostname) {
    return null;
  }

  return OPERATORS.find((operator) => operator.zones.some((zone) => hasSuffix(hostname, zone))) ?? null;
}

export type IdentityCheck =
  | { kind: "crawler"; status: "verified" | "fake" | "unverified"; crawler: Crawler }
  | { kind: "operator"; status: "verified" | "unverified"; operator: Operator }
  | null;

/**
 * "Fake" is reserved for a documented crawler hostname that fails the check
 * (resolves elsewhere, or does not exist) — the case the operators themselves
 * describe as an impostor. A plain
 * operator domain that fails could be a CDN, a pooled name, or a stale
 * record, so it is only ever "unverified".
 */
export function checkIdentity(
  hostname: string | null,
  verdict: Verdict,
  /** Where the name came from. "Fake" needs a name live DNS actually published. */
  source: HostnameChoice["source"] = "live",
): IdentityCheck {
  const crawler = crawlerFor(hostname);

  if (crawler) {
    // The operator's procedure fails a name that resolves elsewhere AND one
    // its own DNS says does not exist: either way it is not their crawler.
    // But the procedure starts from the live PTR. A name that is only in
    // ipgeolocation.io's stored record — live DNS did not answer — was never
    // seen claiming anything, so it can be unverified, never fake.
    // Baidu and Yandex are deliberately NOT exempt: their published procedures
    // say a name that fails the forward check is not theirs.
    const failed = verdict === "mismatch" || (verdict === "unresolvable" && !crawler.forwardOptional);
    const status =
      verdict === "confirmed" ? "verified" : failed && source !== "ipgeolocation" ? "fake" : "unverified";

    return { kind: "crawler", status, crawler };
  }

  const operator = operatorFor(hostname);

  if (operator) {
    return { kind: "operator", status: verdict === "confirmed" ? "verified" : "unverified", operator };
  }

  return null;
}

/**
 * Where the name that was finally checked came from. chooseHostname() decides
 * the order to try names in; this labels the one that won. The stored name is
 * only reported as out of date when live DNS no longer publishes it — if it
 * is still published but another name won, it is one of the alternatives.
 */
export function finalSource(
  choice: HostnameChoice,
  chosen: string,
  stored: string | null,
): { source: HostnameChoice["source"]; storedHostname: string | null } {
  if (choice.source === "ipgeolocation") {
    return { source: "ipgeolocation", storedHostname: null };
  }

  if (chosen === stored) {
    return { source: "agree", storedHostname: null };
  }

  // "agree" here means the stored name is among the live ones: still current.
  return { source: "live", storedHostname: choice.source === "agree" ? null : stored };
}

export type CandidateResult = { name: string; forward: ForwardResult; verdict: Verdict };

/** Best first: a confirmation settles it; an open question beats a failure. */
const RANK: Record<Verdict, number> = { confirmed: 0, inconclusive: 1, mismatch: 2, unresolvable: 3, none: 4 };

/**
 * Picks which of an address's PTR names to report. Keeping the first answer
 * made the verdict depend on the order DNS listed the names in: a name that
 * failed outright would beat another whose check simply had not completed,
 * turning an open question into "does not point back".
 */
export function pickBest(results: CandidateResult[]): CandidateResult | null {
  return results.length === 0
    ? null
    : results.reduce((best, next) => (RANK[next.verdict] < RANK[best.verdict] ? next : best));
}
