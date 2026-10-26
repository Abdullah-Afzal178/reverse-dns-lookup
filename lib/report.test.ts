import assert from "node:assert/strict";

import type { HostnameReport, ReverseResult } from "@/lib/lookup";
import { bulkTally, hostnameSummary, sourceNote } from "@/lib/report";
import type { Verdict } from "@/lib/verify";

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

function row(verdict: Verdict, hostname: string | null, extra: Partial<ReverseResult> = {}): ReverseResult {
  return {
    ip: "198.51.101.1",
    hostname,
    source: hostname ? "agree" : null,
    storedHostname: null,
    apiHostname: null,
    alternatives: [],
    omittedNames: 0,
    forward: null,
    verdict,
    identity: null,
    anatomy: null,
    network: null,
    error: null,
    apiProblem: null,
    ...extra,
  };
}

// --- the bulk tally is a partition -------------------------------------
{
  const rows = [
    row("confirmed", "a.example"),
    row("mismatch", "b.example"),
    row("unresolvable", "c.example"),
    row("inconclusive", "d.example"),
    row("none", null),
    row("none", null),
    row("inconclusive", null),
    row("none", null, { error: "private" }),
    row("confirmed", "e.example", { source: "ipgeolocation" }),
    row("confirmed", "f.example", { source: "live", storedHostname: "old.example" }),
  ];
  const t = bulkTally(rows);
  check(t.withName + t.noPtr + t.noAnswer + t.failed, t.total, "the top-level groups always add up to the total");
  check(t.confirmed + t.mismatch + t.unresolvable + t.unchecked, t.withName, "the breakdown always adds up to 'with a hostname'");
  check([t.withName, t.noPtr, t.noAnswer, t.failed], [6, 2, 1, 1], "each row lands in exactly one group");
  check([t.storedOnly, t.liveOnly], [1, 1], "stored-only and live-replaced names are counted for their notes");
  check(
    t.line,
    "10 addresses · 6 with a hostname (3 forward-confirmed, 1 not pointing back, 1 unresolvable, 1 could not be checked) · 2 with no PTR record · 1 with no answer from DNS · 1 not looked up",
    "the line reads as a breakdown",
  );
}
{
  // Third review: every PTR timing out used to read "0 with a hostname" and nothing else.
  const t = bulkTally([row("inconclusive", null), row("inconclusive", null)]);
  check(t.line, "2 addresses · 0 with a hostname · 2 with no answer from DNS", "unknown PTRs are not passed off as no hostname");
}
check(bulkTally([row("confirmed", "a.example")]).line, "1 address · 1 with a hostname (1 forward-confirmed)", "singular");

// --- the hostname summary ----------------------------------------------
function report(results: ReverseResult[], extra: Partial<HostnameReport> = {}, failed: ("v4" | "v6")[] = [], hidden = 0): HostnameReport {
  return {
    hostname: "mx.example.org",
    forward: { status: "resolved", addresses: results.map((_, i) => `198.51.101.${i + 1}`), failedFamilies: failed, hidden },
    results,
    unchecked: 0,
    ...extra,
  };
}
const s = (r: HostnameReport) => hostnameSummary(r);

check(s(report([row("confirmed", "a"), row("confirmed", "b")])).summary.startsWith("Every address behind mx.example.org"), true, "all confirm, nothing missing");
check(s(report([row("confirmed", "a")])).summary.startsWith("mx.example.org's only address has reverse DNS that forward-confirms"), true, "one address, singular");
check(s(report([row("confirmed", "a")], {}, ["v6"])).summary.startsWith("The one address checked behind mx.example.org forward-confirms, but"), true, "one checked, a family missing");
check(s(report([row("confirmed", "a"), row("confirmed", "b")], { unchecked: 4 })).summary.startsWith("All 2 addresses checked"), true, "a sampled pool is not 'every address'");
check(s(report([row("none", null)])).summary.startsWith("mx.example.org's only address lacks forward-confirmed"), true, "one address lacking, singular");
check(s(report([row("none", null)], {}, ["v6"])).summary.startsWith("The one address checked behind mx.example.org lacks"), true, "not 'only address' when a family did not answer");
check(s(report([], {}, ["v6"], 2)).summary.includes("not every lookup answered"), true, "nor 'resolves only to private' when a family did not answer");
check(s(report([row("confirmed", "a"), row("none", null)])).summary.startsWith("1 of 2 addresses behind mx.example.org lacks"), true, "one of two lacks — singular verb");
check(s(report([row("none", null), row("mismatch", "b"), row("confirmed", "c")])).summary.startsWith("2 of 3 addresses behind mx.example.org lack"), true, "two of three lack — plural verb");
check(s(report([row("inconclusive", "a")])).summary, "The address behind mx.example.org could not be checked this time. Try again for an answer.", "one unchecked, singular");
check(s(report([row("confirmed", "a"), row("inconclusive", "b")])).summary.startsWith("1 of 2 addresses forward-confirm; 1 address could not be checked"), true, "some unchecked");
check(s(report([row("confirmed", "a"), row("none", null, { error: "private" })])).summary.startsWith("The one address checked"), true, "an errored row is not 'every address'");

check(s(report([row("confirmed", "a")], {}, ["v4"])).header, "mx.example.org resolves to at least 1 public address", "a missing family makes the count a floor");
check(s(report([row("confirmed", "a")], {}, ["v4"])).caveats[0].startsWith("The IPv4 (A) lookup for mx.example.org did not answer"), true, "and is named");
check(s(report([row("confirmed", "a")], {}, [], 2)).caveats, ["2 private or internal addresses are not shown, because they have no public reverse DNS."], "hidden internal addresses are counted, not listed");
check(s(report([], {}, [], 2)).summary, "mx.example.org resolves only to private or internal addresses, which have no public reverse DNS.", "a name with only internal addresses");
check(s(report([row("confirmed", "a")], { unchecked: 1 })).caveats, ["1 more address was not checked, because large pools are sampled to keep the lookup quick."], "sampling note, singular");
check(
  hostnameSummary({ hostname: "gone.example", forward: { status: "failed", reason: "The name does not exist in DNS.", transient: false }, results: [], unchecked: 0 }),
  { header: "gone.example did not resolve", summary: "The name does not exist in DNS.", caveats: [] },
  "a name that does not resolve",
);


// --- the source note only says what is known ------------------------------
{
  const resolvedForward = { status: "resolved" as const, addresses: ["198.51.101.1"], failedFamilies: [] };
  const live = (extra: Partial<ReverseResult>) => row("confirmed", "b.example", { source: "live", forward: resolvedForward, ...extra });

  check(sourceNote(row("confirmed", "a.example", { forward: resolvedForward })).startsWith("ipgeolocation.io's record and live DNS agree"), true, "agree");
  check(sourceNote(live({ apiHostname: null })).startsWith("ipgeolocation.io had no name on record"), true, "the API answered with no name");
  check(sourceNote(live({ apiHostname: "old.example", storedHostname: "old.example" })).startsWith("Live DNS now publishes a different name"), true, "the stored name is out of date");

  // Fourth review: these used to claim the API "had no name on record".
  const down = live({ apiProblem: "ipgeolocation.io refused the API key, so this result comes from live DNS alone." });
  check(sourceNote(down).startsWith("This name is published in live DNS; ipgeolocation.io's record could not be consulted"), true, "API down: nothing is claimed about its record");
  check(sourceNote(down).includes("had no name"), false, "and certainly not that it had no name");

  const alt = live({
    apiHostname: "a.example",
    alternatives: [{ name: "a.example", verdict: "mismatch", forward: resolvedForward }],
  });
  check(sourceNote(alt).startsWith("ipgeolocation.io's record (a.example) is also published and listed above"), true, "a stored name that lost to another PTR name is still current");
  check(sourceNote(alt).includes("had no name"), false, "so it is never called missing");

  check(sourceNote(row("none", null, { apiProblem: "down" })), "Checked against live DNS only, because ipgeolocation.io could not be consulted.", "no PTR, API down");
  check(sourceNote(row("none", null, { apiHostname: "gone.example" })).startsWith("Live DNS publishes no PTR"), true, "no PTR, stale stored name");
  check(sourceNote(row("none", null)), "Checked against ipgeolocation.io's records and live DNS.", "no PTR, nothing stored");
  check(
    sourceNote(row("confirmed", "s.example", { source: "ipgeolocation", forward: resolvedForward })).startsWith("The live PTR query failed"),
    true,
    "the stored record stood in",
  );
  check(
    sourceNote(row("inconclusive", "a.example", { forward: { status: "failed", reason: "x", transient: true } })).includes("forward check is a live query"),
    false,
    "it never claims a forward check that did not complete",
  );
}


// Sixth review: a stored-only confirmation is not what a mail server sees today.
{
  const stored = row("confirmed", "mx.example.org", { source: "ipgeolocation" });
  const result = s(report([stored]));
  check(result.summary.startsWith("Every") || result.summary.includes("only address has"), false, "a stored-only confirmation is not 'every address' for a mail server");
  check(result.caveats.some((c) => c.startsWith("The live PTR query for 1 address did not answer")), true, "and the caveat says why");
}

console.log(`report: ${checks} assertions passed`);
