import assert from "node:assert/strict";

import {
  CRAWLERS,
  OPERATORS,
  checkIdentity,
  chooseHostname,
  combineFamilies,
  crawlerFor,
  describeDnsError,
  finalSource,
  MAX_PTR_CANDIDATES,
  pickBest,
  hasSuffix,
  isDefinitive,
  normalizePtr,
  operatorFor,
  verdictFor,
  type ForwardResult,
} from "@/lib/verify";

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

const ok = (...addresses: string[]) => ({ ok: true as const, addresses });
const err = (code: string | undefined) => ({ ok: false as const, code });
const resolved = (addresses: string[], failedFamilies: ("v4" | "v6")[] = []): ForwardResult => ({
  status: "resolved",
  addresses,
  failedFamilies,
});

// --- normalising the API answer ----------------------------------------
check(normalizePtr("dns.google", "8.8.8.8"), "dns.google", "a real hostname passes");
check(normalizePtr("DNS.Google.", "8.8.8.8"), "dns.google", "lowercased, root dot dropped");
check(normalizePtr("8.8.8.8", "8.8.8.8"), null, "an echoed IPv4 means no hostname");
check(normalizePtr("2606:4700:4700:0:0:0:0:1111", "2606:4700:4700::1111"), null, "an echoed IPv6 in the bulk spelling means none");
check(normalizePtr("9.9.9.9", "8.8.8.8"), null, "any bare IP is not a hostname");
check(normalizePtr("", "8.8.8.8"), null, "empty is none");
check(normalizePtr("??", "8.8.8.8"), null, "the ?? sentinel is none");
check(normalizePtr("Unknown", "8.8.8.8"), null, "the Unknown sentinel is none");
check(normalizePtr(undefined, "8.8.8.8"), null, "a missing field is none");

// --- definitive vs transient error codes -------------------------------
check(isDefinitive("ENOTFOUND"), true, "NXDOMAIN is a fact about the name");
check(isDefinitive("ENODATA"), true, "no records is a fact about the name");
for (const code of ["ETIMEOUT", "ESERVFAIL", "EREFUSED", "ECONNREFUSED", "EDEADLINE", undefined]) {
  check(isDefinitive(code), false, `${code} is the lookup failing, not the record`);
}

// --- merging the two families ------------------------------------------
check(combineFamilies(ok("8.8.8.8"), ok("2001:4860:4860::8888")), resolved(["8.8.8.8", "2001:4860:4860::8888"]), "both families");
check(combineFamilies(ok("8.8.8.8"), err("ENODATA")), resolved(["8.8.8.8"]), "an IPv4-only name is fully resolved");
check(combineFamilies(err("ETIMEOUT"), ok("2001:4860:4860::8888")), resolved(["2001:4860:4860::8888"], ["v4"]), "a timed-out family is remembered");
check(combineFamilies(err("ENOTFOUND"), err("ENOTFOUND")), { status: "failed", reason: describeDnsError("ENOTFOUND"), transient: false }, "NXDOMAIN on both is definitive");
check(combineFamilies(err("ENODATA"), err("ENODATA")), { status: "failed", reason: describeDnsError("ENODATA"), transient: false }, "no records on both is definitive");
check(combineFamilies(err("ENODATA"), err("ENOTFOUND")), { status: "failed", reason: describeDnsError("ENOTFOUND"), transient: false }, "NXDOMAIN outranks ENODATA");
check(combineFamilies(err("EREFUSED"), err("ENODATA")), { status: "failed", reason: describeDnsError("EREFUSED"), transient: true }, "a refusal makes the failure transient");
check(combineFamilies(err(undefined), err(undefined)), { status: "failed", reason: describeDnsError(undefined), transient: true }, "an unknown failure is never treated as a fact");
// Seen live: a bogus TLD answered NXDOMAIN on AAAA while the A query timed out.
check(combineFamilies(err("ETIMEOUT"), err("ENOTFOUND")), { status: "failed", reason: describeDnsError("ENOTFOUND"), transient: false }, "NXDOMAIN on either family settles it");
check(combineFamilies(err("ENOTFOUND"), err("ETIMEOUT")), { status: "failed", reason: describeDnsError("ENOTFOUND"), transient: false }, "whichever family says it");
check(combineFamilies(err("ETIMEOUT"), err("ENODATA")), { status: "failed", reason: describeDnsError("ETIMEOUT"), transient: true }, "but ENODATA on one family does not excuse a timeout on the other");

// --- choosing the hostname ---------------------------------------------
check(chooseHostname("dns.google", { status: "names", names: ["dns.google"] }), { candidates: ["dns.google"], source: "agree", storedHostname: null, unknown: false, omitted: 0 }, "live and stored agree");
check(chooseHostname("unknown.yahoo.com", { status: "names", names: ["media-router-fp74.prod.media.vip.bf1.yahoo.com"] }), { candidates: ["media-router-fp74.prod.media.vip.bf1.yahoo.com"], source: "live", storedHostname: "unknown.yahoo.com", unknown: false, omitted: 0 }, "the reviewed bug: a stale stored name loses to the live PTR");
check(chooseHostname(null, { status: "names", names: ["one.one.one.one"] }), { candidates: ["one.one.one.one"], source: "live", storedHostname: null, unknown: false, omitted: 0 }, "live finds what the store lacks");
check(chooseHostname("b.example", { status: "names", names: ["a.example", "b.example", "c.example", "d.example"] }).candidates, ["b.example", "a.example", "c.example", "d.example"], "the agreed name goes first, and all four are checked");
{
  // Sixth review: a cap of three silently dropped a fourth name that confirmed.
  const many = Array.from({ length: MAX_PTR_CANDIDATES + 5 }, (_, i) => `n${i}.example`);
  const choice = chooseHostname(null, { status: "names", names: many });
  check([choice.candidates.length, choice.omitted], [MAX_PTR_CANDIDATES, 5], "past the cap, names are counted as omitted, never silently dropped");
}
check(chooseHostname("c-73-162-0-1.hsd1.ca.comcast.net", { status: "none" }), { candidates: [], source: null, storedHostname: "c-73-162-0-1.hsd1.ca.comcast.net", unknown: false, omitted: 0 }, "no PTR published now: the stored name is history");
check(chooseHostname("dns.google", { status: "failed" }), { candidates: ["dns.google"], source: "ipgeolocation", storedHostname: null, unknown: false, omitted: 0 }, "live DNS silent: the stored name stands in");
check(chooseHostname(null, { status: "failed" }), { candidates: [], source: null, storedHostname: null, unknown: true, omitted: 0 }, "nothing answered: whether a PTR exists is unknown");
check(chooseHostname(null, { status: "none" }).unknown, false, "a definite 'no PTR' is known, not unknown");

// --- the verdict -------------------------------------------------------
check(verdictFor(null, null, "8.8.8.8"), "none", "no hostname");
check(verdictFor("dns.google", resolved(["8.8.8.8", "8.8.4.4"]), "8.8.8.8"), "confirmed", "the name points back");
check(verdictFor("dns.google", resolved(["8.8.4.4"]), "8.8.8.8"), "mismatch", "the name points elsewhere");
check(verdictFor("one.one.one.one", resolved(["2606:4700:4700::1111"]), "2606:4700:4700:0:0:0:0:1111"), "confirmed", "IPv6 matches across spellings");
check(verdictFor("x.example.com", resolved([]), "8.8.8.8"), "mismatch", "resolving to nothing at all is not a match");
check(verdictFor("gone.example.com", { status: "failed", reason: "", transient: false }, "8.8.8.8"), "unresolvable", "a name that does not exist");
check(verdictFor("x.example.com", { status: "failed", reason: "", transient: true }, "8.8.8.8"), "inconclusive", "a lookup that failed proves nothing");
check(verdictFor("x.example.com", null, "8.8.8.8"), "inconclusive", "a lookup that never ran proves nothing");
// The reviewed bug: A timed out, AAAA answered, and the IPv4 address was missing.
check(verdictFor("dns.google", resolved(["2001:4860:4860::8888"], ["v4"]), "8.8.8.8"), "inconclusive", "a timed-out own family is not a mismatch");
check(verdictFor("dns.google", resolved(["8.8.8.8"], ["v6"]), "2001:4860:4860::8888"), "inconclusive", "the same for IPv6");
check(verdictFor("dns.google", resolved(["8.8.4.4"], ["v6"]), "8.8.8.8"), "mismatch", "but the OTHER family failing does not excuse a real mismatch");
check(verdictFor("dns.google", resolved(["2001:4860:4860::8888"], ["v4"]), "2001:4860:4860::8888"), "confirmed", "a confirmation stands whatever failed elsewhere");

// --- descriptions ------------------------------------------------------
check(describeDnsError("ENOTFOUND"), "The name does not exist in DNS.", "NXDOMAIN");
check(describeDnsError("EREFUSED").includes("checking side"), true, "a refusal is not blamed on the record");
check(describeDnsError("ETIMEOUT").includes("says nothing about the record"), true, "a timeout is not blamed on the record");
check(describeDnsError("ENODATA").includes("stale"), false, "no description claims staleness — that is the verdict's job");
check(describeDnsError("SOMETHING_NEW"), "The DNS lookup failed. Try again.", "an unknown code gets a safe default");

// --- suffix matching ---------------------------------------------------
check(hasSuffix("crawl-66-249-66-1.googlebot.com", "googlebot.com"), true, "a subdomain matches");
check(hasSuffix("googlebot.com", "googlebot.com"), true, "the apex matches");
check(hasSuffix("evilgooglebot.com", "googlebot.com"), false, "a lookalike without the dot does not match");
check(hasSuffix("googlebot.com.evil.net", "googlebot.com"), false, "the suffix must be at the end");

// --- crawler identification --------------------------------------------
check(crawlerFor("crawl-66-249-66-1.googlebot.com")?.name, "Googlebot", "a Googlebot crawl host");
check(crawlerFor("geo-crawl-35-247-243-240.geo.googlebot.com")?.name, "Googlebot", "a geo crawl host");
check(crawlerFor("crawl-2001-4860-4801-0010-0000-0000-0000-0005.googlebot.com")?.name, "Googlebot", "an IPv6 Googlebot host");
// Fifth review: Google documents these as other kinds — none of them is Googlebot.
check(crawlerFor("rate-limited-proxy-66-249-90-1.google.com")?.name, "Google special-case crawler", "a special-case crawler is named as one");
check(crawlerFor("google-proxy-66-249-81-1.google.com")?.name, "Google user-triggered fetcher", "a user-triggered fetcher is named as one");
check(crawlerFor("1.192.178.107.gae.googleusercontent.com"), null, "an App Engine name is not a crawler — it may be a Cloud customer's");
check(operatorFor("1.192.178.107.gae.googleusercontent.com"), null, "nor is it proof of Google's own traffic");
for (const host of ["rate-limited-proxy-108-177-2-1.google.com", "google-proxy-142-250-32-1.google.com", "1.192.178.107.gae.googleusercontent.com"]) {
  check(crawlerFor(host)?.name === "Googlebot", false, `${host} is never called Googlebot`);
}
// The reviewed bug: these are Google's, but they are not crawlers.
check(crawlerFor("mail-sor-f41.google.com"), null, "Gmail's outbound mail server is not Googlebot");
check(crawlerFor("lga34s34-in-f14.1e100.net"), null, "a 1e100.net front end is not Googlebot");
check(crawlerFor("1.2.3.4.bc.googleusercontent.com"), null, "a Google Cloud customer VM is not Googlebot");
check(crawlerFor("mxfront.stable.qloud-b.yandex.net"), null, "Yandex's mail front end is not YandexBot");
check(crawlerFor("yandex.ru"), null, "a bare yandex.ru PTR is not YandexBot");
check(crawlerFor("spider-141-8-142-60.yandex.com")?.name, "YandexBot", "a Yandex spider host");
check(crawlerFor("100-43-90-17.spider.yandex.com")?.name, "YandexBot", "the other Yandex spider shape");
check(crawlerFor("msnbot-157-55-39-1.search.msn.com")?.name, "Bingbot", "Bingbot");
check(crawlerFor("17-58-101-1.applebot.apple.com")?.name, "Applebot", "Applebot");
check(crawlerFor("baiduspider-123-125-71-1.crawl.baidu.com")?.name, "Baiduspider", "Baiduspider");
check(crawlerFor("www.baidu.com"), null, "a Baidu web server is not Baiduspider");
check(crawlerFor("crawl-1-2-3-4.crawl.amazonbot.amazon")?.name, "Amazonbot", "Amazonbot");
check(crawlerFor("dns.google"), null, "dns.google is not a crawler");

// --- operators ---------------------------------------------------------
check(operatorFor("mail-sor-f41.google.com")?.name, "Google", "Gmail's mail server belongs to Google");
check(operatorFor("lga34s34-in-f14.1e100.net")?.name, "Google", "1e100.net belongs to Google");
check(operatorFor("mxfront.stable.qloud-b.yandex.net")?.name, "Yandex", "a Yandex host belongs to Yandex");
check(operatorFor("dns.google"), null, "dns.google is not in a listed operator zone");
check(operatorFor("1.2.3.4.bc.googleusercontent.com"), null, "a Cloud VM is the customer's, not Google's");
check(
  [...CRAWLERS.map((c) => c.operator)].every((name) => OPERATORS.some((o) => o.name === name)),
  true,
  "every crawler's operator is listed",
);

// --- identity checks ---------------------------------------------------
check(checkIdentity("crawl-66-249-66-1.googlebot.com", "confirmed")?.status, "verified", "a confirmed crawler is verified");
check(checkIdentity("crawl-66-249-66-1.googlebot.com", "mismatch")?.status, "fake", "a crawler host that resolves elsewhere is fake");
check(checkIdentity("crawl-66-249-66-1.googlebot.com", "inconclusive")?.status, "unverified", "a failed lookup does not convict");
// The reviewed bug: a forged crawler PTR whose name does not exist in the operator's zone.
check(checkIdentity("crawl-203-0-114-77.googlebot.com", "unresolvable")?.status, "fake", "a crawler name the operator's DNS does not know is fake");
check(checkIdentity("yandex.ru", "unresolvable")?.status, "unverified", "an operator name that does not resolve is still never fake");
check(checkIdentity("mail-sor-f41.google.com", "confirmed"), { kind: "operator", status: "verified", operator: OPERATORS[0] }, "Gmail's server is a verified Google host, not Googlebot");
check(checkIdentity("yandex.ru", "mismatch")?.status, "unverified", "an operator name that fails is unverified, never fake");
check(checkIdentity("yandex.ru", "mismatch")?.kind, "operator", "and is not called a crawler");
check(checkIdentity("dns.google", "confirmed"), null, "an unlisted host gets no identity check");
check(checkIdentity(null, "none"), null, "no hostname, no identity");


// --- final source ------------------------------------------------------
{
  const agree = { candidates: ["a.example", "b.example"], source: "agree" as const, storedHostname: null, unknown: false, omitted: 0 };
  check(finalSource(agree, "a.example", "a.example"), { source: "agree", storedHostname: null }, "the stored name won");
  // The reviewed bug: a different live name confirmed, but the label still said "agree".
  // Third review: the stored name is STILL published here, so it is not out of date.
  check(finalSource(agree, "b.example", "a.example"), { source: "live", storedHostname: null }, "another live name won, and the stored one is still published — not stale");
  const live = { candidates: ["n.example"], source: "live" as const, storedHostname: "old.example", unknown: false, omitted: 0 };
  check(finalSource(live, "n.example", "old.example"), { source: "live", storedHostname: "old.example" }, "a live-only name keeps the stored one for reference");
  check(finalSource(live, "n.example", null), { source: "live", storedHostname: null }, "nothing stored, nothing to mention");
  const fallback = { candidates: ["s.example"], source: "ipgeolocation" as const, storedHostname: null, unknown: false, omitted: 0 };
  check(finalSource(fallback, "s.example", "s.example"), { source: "ipgeolocation", storedHostname: null }, "live DNS silent: the stored record stood in");
}


// --- crawler "fake" needs a live name --------------------------------------
check(checkIdentity("crawl-1-2-3-4.googlebot.com", "unresolvable", "ipgeolocation")?.status, "unverified", "a stored-only crawler name is never fake");
check(checkIdentity("crawl-1-2-3-4.googlebot.com", "mismatch", "ipgeolocation")?.status, "unverified", "not even when it resolves elsewhere");
check(checkIdentity("crawl-1-2-3-4.googlebot.com", "mismatch", "live")?.status, "fake", "a live crawler name that fails is fake");
check(checkIdentity("crawl-1-2-3-4.googlebot.com", "mismatch", "agree")?.status, "fake", "and so is one both sources agree on");
check(checkIdentity("crawl-1-2-3-4.googlebot.com", "confirmed", "ipgeolocation")?.status, "verified", "a stored name that confirms is still verified");

// --- picking among several PTR names --------------------------------------
{
  const r = (name: string, verdict: "confirmed" | "mismatch" | "unresolvable" | "inconclusive") => ({ name, verdict, forward: resolved([]) });
  check(pickBest([]), null, "no names, no pick");
  check(pickBest([r("a", "mismatch"), r("b", "confirmed")])?.name, "b", "a confirmation wins wherever it is");
  // The reviewed bug: answer order decided the verdict.
  check(pickBest([r("a", "mismatch"), r("b", "inconclusive")])?.verdict, "inconclusive", "an unchecked name beats a failed one: the question is still open");
  check(pickBest([r("b", "inconclusive"), r("a", "mismatch")])?.verdict, "inconclusive", "whatever order DNS listed them in");
  check(pickBest([r("a", "unresolvable"), r("b", "mismatch")])?.name, "b", "a name that resolves somewhere outranks one that does not exist");
  check(pickBest([r("a", "mismatch"), r("b", "mismatch")])?.name, "a", "on a tie the first answer stands");
}


// --- Google's user-triggered fetchers are not fake for a missing name -------
check(checkIdentity("google-proxy-136-122-178-35.google.com", "unresolvable", "live")?.status, "unverified", "a google-proxy name with no forward record is unverified, not fake");
check(checkIdentity("google-proxy-136-122-178-35.google.com", "mismatch", "live")?.status, "fake", "but one that resolves somewhere else is still fake");
// Baidu and Yandex keep their own rule: a name that fails the forward check is not theirs.
check(checkIdentity("baiduspider-180-76-15-17.crawl.baidu.com", "unresolvable", "live")?.status, "fake", "Baiduspider follows Baidu's documented procedure");
check(checkIdentity("141-8-142-221.spider.yandex.com", "unresolvable", "live")?.status, "fake", "YandexBot follows Yandex's documented procedure");

console.log(`verify: ${checks} assertions passed`);
