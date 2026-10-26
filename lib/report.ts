/**
 * The sentences and counts that summarise a list or a hostname. Pure, so the
 * arithmetic and the grammar can both be tested rather than eyeballed.
 */

import type { HostnameReport, ReverseResult } from "@/lib/lookup";

const plural = (n: number, word = "address", many = "addresses") => `${n} ${n === 1 ? word : many}`;

export type BulkTally = {
  total: number;
  withName: number;
  confirmed: number;
  mismatch: number;
  unresolvable: number;
  /** Has a name, but its forward check did not complete. */
  unchecked: number;
  /** DNS said there is no PTR record. */
  noPtr: number;
  /** The PTR lookup itself got no answer, so whether a name exists is unknown. */
  noAnswer: number;
  /** Never looked up: private, reserved, or the API failed for it. */
  failed: number;
  /** Rows whose name is ipgeolocation.io's stored record, because live DNS did not answer. */
  storedOnly: number;
  /** Rows whose name came from live DNS because the stored record was missing or out of date. */
  liveOnly: number;
  /** The tally as one line. Its top-level groups always add up to the total. */
  line: string;
};

export function bulkTally(results: ReverseResult[]): BulkTally {
  const count = (test: (r: ReverseResult) => boolean) => results.filter(test).length;
  const named = (r: ReverseResult) => !r.error && r.hostname !== null;

  const tally = {
    total: results.length,
    withName: count(named),
    confirmed: count((r) => named(r) && r.verdict === "confirmed"),
    mismatch: count((r) => named(r) && r.verdict === "mismatch"),
    unresolvable: count((r) => named(r) && r.verdict === "unresolvable"),
    unchecked: count((r) => named(r) && r.verdict === "inconclusive"),
    noPtr: count((r) => !r.error && r.hostname === null && r.verdict !== "inconclusive"),
    noAnswer: count((r) => !r.error && r.hostname === null && r.verdict === "inconclusive"),
    failed: count((r) => r.error !== null),
    storedOnly: count((r) => named(r) && r.source === "ipgeolocation"),
    liveOnly: count((r) => named(r) && r.source === "live" && r.storedHostname !== null),
  };

  const breakdown = [
    tally.confirmed ? `${tally.confirmed} forward-confirmed` : null,
    tally.mismatch ? `${tally.mismatch} not pointing back` : null,
    tally.unresolvable ? `${tally.unresolvable} unresolvable` : null,
    tally.unchecked ? `${tally.unchecked} could not be checked` : null,
  ].filter(Boolean);

  const line = [
    plural(tally.total),
    `${tally.withName} with a hostname${breakdown.length ? ` (${breakdown.join(", ")})` : ""}`,
    tally.noPtr ? `${tally.noPtr} with no PTR record` : null,
    tally.noAnswer ? `${tally.noAnswer} with no answer from DNS` : null,
    tally.failed ? `${tally.failed} not looked up` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { ...tally, line };
}

export type HostnameSummary = { header: string; summary: string; caveats: string[] };

export function hostnameSummary(report: HostnameReport): HostnameSummary {
  const { hostname, forward, results, unchecked: sampled } = report;

  if (forward.status === "failed") {
    return { header: `${hostname} did not resolve`, summary: forward.reason, caveats: [] };
  }

  const hidden = forward.hidden ?? 0;
  const looked = results.filter((r) => !r.error);
  const errored = results.length - looked.length;
  const confirmed = looked.filter((r) => r.verdict === "confirmed").length;
  // A failed lookup is not evidence of a missing record, so it is kept apart
  // from the addresses that genuinely lack forward-confirmed DNS.
  const open = looked.filter((r) => r.verdict === "inconclusive").length;
  const lacking = looked.length - confirmed - open;
  const n = looked.length;

  const missing = forward.failedFamilies.map((family) =>
    family === "v4" ? { record: "IPv4 (A)", kind: "IPv4" } : { record: "IPv6 (AAAA)", kind: "IPv6" },
  );
  // Rows whose name is only the stored record: the live PTR query got no
  // answer, so a receiving server may see nothing there right now.
  const storedOnly = looked.filter((r) => r.source === "ipgeolocation").length;
  // "Every address" is only true when nothing was skipped, failed, hidden,
  // unseen, or resting on a stored record alone.
  const complete = errored === 0 && sampled === 0 && missing.length === 0 && hidden === 0 && storedOnly === 0;

  const header = `${hostname} resolves to ${missing.length > 0 ? "at least " : ""}${plural(forward.addresses.length, "public address", "public addresses")}`;

  let summary: string;

  if (n === 0) {
    summary =
      forward.addresses.length === 0 && hidden > 0
        ? missing.length > 0
          ? `The addresses found for ${hostname} are all private or internal, which have no public reverse DNS. As noted below, though, not every lookup answered.`
          : `${hostname} resolves only to private or internal addresses, which have no public reverse DNS.`
        : `None of ${hostname}'s addresses could be looked up.`;
  } else if (lacking === 0 && open === 0) {
    summary = complete
      ? n === 1
        ? `${hostname}'s only address has reverse DNS that forward-confirms, which is what a receiving mail server wants to see.`
        : `Every address behind ${hostname} has reverse DNS that forward-confirms, which is what a receiving mail server wants to see.`
      : n === 1
        ? `The one address checked behind ${hostname} forward-confirms, but as noted below, that is not every address.`
        : `All ${n} addresses checked behind ${hostname} forward-confirm, but as noted below, that is not every address.`;
  } else if (lacking === 0) {
    summary =
      n === 1
        ? `The address behind ${hostname} could not be checked this time. Try again for an answer.`
        : `${confirmed} of ${n} addresses forward-confirm; ${plural(open)} could not be checked this time. Try again for a complete answer.`;
  } else {
    const subject =
      n === 1
        ? complete
          ? `${hostname}'s only address lacks`
          : `The one address checked behind ${hostname} lacks`
        : `${lacking} of ${n} addresses behind ${hostname} ${lacking === 1 ? "lacks" : "lack"}`;
    const which = lacking === 1 ? "that address" : "those addresses";

    summary = `${subject} forward-confirmed reverse DNS. If this server sends mail, mail from ${which} is more likely to be rejected or filtered.${open ? ` ${plural(open)} could not be checked this time.` : ""}`;
  }

  const caveats = [
    ...missing.map(
      (family) =>
        `The ${family.record} lookup for ${hostname} did not answer, so any ${family.kind} addresses it has are not listed. Try again for a complete answer.`,
    ),
    hidden > 0
      ? `${plural(hidden, "private or internal address", "private or internal addresses")} ${hidden === 1 ? "is" : "are"} not shown, because they have no public reverse DNS.`
      : null,
    errored > 0 ? `${plural(errored)} could not be looked up. The reason is shown against each one below.` : null,
    storedOnly > 0
      ? `The live PTR query for ${plural(storedOnly)} did not answer, so ${storedOnly === 1 ? "that result rests" : "those results rest"} on ipgeolocation.io's stored record, so a receiving mail server may see no PTR there right now.`
      : null,
    sampled > 0
      ? `${sampled} more ${sampled === 1 ? "address was" : "addresses were"} not checked, because large pools are sampled to keep the lookup quick.`
      : null,
  ].filter((caveat): caveat is string => caveat !== null);

  return { header, summary, caveats };
}

/**
 * Where the hostname came from, in one line. Built from what is actually
 * known — apiProblem says whether ipgeolocation.io was consulted at all, and
 * apiHostname says what it holds — never inferred from storedHostname.
 */
export function sourceNote(result: ReverseResult): string {
  const { hostname, source, storedHostname, apiHostname, apiProblem, forward, alternatives } = result;
  const consulted = apiProblem === null;

  if (!hostname) {
    if (!consulted) {
      return "Checked against live DNS only, because ipgeolocation.io could not be consulted.";
    }

    return apiHostname
      ? "Live DNS publishes no PTR for this address now. ipgeolocation.io's stored name is shown above for reference only."
      : "Checked against ipgeolocation.io's records and live DNS.";
  }

  const checked = forward?.status === "resolved" || (forward?.status === "failed" && !forward.transient);
  const tail = checked ? " The forward check is a live query made just now." : "";

  if (source === "agree") {
    return `ipgeolocation.io's record and live DNS agree on this name.${tail}`;
  }

  if (source === "ipgeolocation") {
    return `The live PTR query failed (it timed out, or the reverse zone returned an error), so this is ipgeolocation.io's stored record.${tail}`;
  }

  // From here on the name came from live DNS.
  if (!consulted) {
    return `This name is published in live DNS; ipgeolocation.io's record could not be consulted.${tail}`;
  }

  if (storedHostname) {
    return `Live DNS now publishes a different name from ipgeolocation.io's record, so the live one is what was checked.${tail}`;
  }

  if (apiHostname && alternatives.some((alt) => alt.name === apiHostname)) {
    return `ipgeolocation.io's record (${apiHostname}) is also published and listed above, but this name is the one that ${
      result.verdict === "confirmed" ? "forward-confirms" : "was checked furthest"
    }.${tail}`;
  }

  return `ipgeolocation.io had no name on record; this one is published in live DNS.${tail}`;
}
