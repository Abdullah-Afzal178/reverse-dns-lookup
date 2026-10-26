/**
 * End-to-end tests for lib/lookup.ts with DNS and the API scripted. Each case
 * is a failure mode found in review, driven through the real code.
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// lookup.ts is server-only and talks to real DNS: swap both before importing it.
const fakeDns = pathToFileURL(`${import.meta.dirname}/test-fake-dns.ts`).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "node:dns/promises") return { url: fakeDns, shortCircuit: true };
    return next(specifier, context);
  },
});

const { script, calls, ok, fail, hang, after, reset } = await import("@/lib/test-fake-dns");
const { reverseMany, reverseHostname, validServers } = await import("@/lib/lookup");

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

// The API: echoes the IP back when nothing is stored, exactly as the real one does.
const stored: Record<string, string | null> = {};
process.env.IPGEOLOCATION_API_KEY = "test-key";
let apiMode: "ok" | "error" | "hang" = "ok";
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  if (apiMode === "error") return new Response(JSON.stringify({ message: "upstream broke" }), { status: 500 });
  if (apiMode === "hang") {
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  }
  const record = (ip: string) => ({ ip, hostname: stored[ip] ?? ip, asn: { organization: "Test Org" }, location: {} });
  const body =
    init?.method === "POST"
      ? (JSON.parse(String(init.body)).ips as string[]).map(record)
      : record(new URL(String(url)).searchParams.get("ip") ?? "");

  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

// Every case gets an address nothing has cached yet.
let serial = 0;
const fresh = () => `198.51.101.${++serial}`;
const ptrName = (ip: string) => `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
const shape = (r: { hostname: string | null; source: unknown; storedHostname: string | null; verdict: string }) => ({
  hostname: r.hostname,
  source: r.source,
  storedHostname: r.storedHostname,
  verdict: r.verdict,
});

// --- happy paths -------------------------------------------------------
{
  reset();
  const ip = fresh();
  stored[ip] = "host.example.org";
  script.resolvePtr[ptrName(ip)] = ok("host.example.org");
  script.resolve4["host.example.org"] = ok(ip);
  const [result] = await reverseMany([ip]);
  check(shape(result), { hostname: "host.example.org", source: "agree", storedHostname: null, verdict: "confirmed" }, "stored and live agree, and it confirms");
}
{
  reset();
  const ip = fresh();
  stored[ip] = null;
  script.resolvePtr[ptrName(ip)] = ok("found.example.org");
  script.resolve4["found.example.org"] = ok(ip);
  const [result] = await reverseMany([ip]);
  check(shape(result), { hostname: "found.example.org", source: "live", storedHostname: null, verdict: "confirmed" }, "live DNS finds what the store lacks");
}

// --- the PTR query must keep its real error codes ------------------------
{
  // Before the fix, dns.reverse() turned this SERVFAIL into "no PTR record".
  reset();
  const ip = fresh();
  stored[ip] = "srv.example.org";
  script.resolvePtr[ptrName(ip)] = fail("ESERVFAIL");
  script.resolve4["srv.example.org"] = ok(ip);
  const [result] = await reverseMany([ip]);
  check(shape(result), { hostname: "srv.example.org", source: "ipgeolocation", storedHostname: null, verdict: "confirmed" }, "a SERVFAIL on the PTR falls back to the stored name");
  const attempts = calls.filter((call) => call.name === ptrName(ip));
  check(attempts.length, 2, "and the PTR query is retried once first");
  check(attempts.map((call) => call.servers.length > 0), [false, true], "first through the system resolver, then a public one");
}
{
  reset();
  const ip = fresh();
  stored[ip] = null;
  script.resolvePtr[ptrName(ip)] = fail("ETIMEOUT");
  const [result] = await reverseMany([ip]);
  check(shape(result), { hostname: null, source: null, storedHostname: null, verdict: "inconclusive" }, "a timeout with nothing stored is 'could not check', not 'no PTR'");
}
{
  reset();
  const ip = fresh();
  stored[ip] = "old.example.org";
  script.resolvePtr[ptrName(ip)] = fail("ENOTFOUND");
  script.resolve4["old.example.org"] = ok(ip);
  const [result] = await reverseMany([ip]);
  check(shape(result), { hostname: null, source: null, storedHostname: "old.example.org", verdict: "none" }, "a genuine NXDOMAIN means no PTR, whatever is stored");
  check(calls.filter((call) => call.name === ptrName(ip)).length, 1, "and a definitive answer is never retried");
}
{
  // A one-off timeout that clears on the retry must not change the answer.
  reset();
  const ip = fresh();
  stored[ip] = null;
  let attempts = 0;
  script.resolvePtr[ptrName(ip)] = () => (++attempts === 1 ? Promise.reject(Object.assign(new Error(), { code: "ETIMEOUT" })) : Promise.resolve(["retry.example.org"]));
  script.resolve4["retry.example.org"] = ok(ip);
  const [result] = await reverseMany([ip]);
  check(result.verdict, "confirmed", "a timeout that clears on retry gives the real answer");
}

// --- several PTR names --------------------------------------------------
{
  reset();
  const ip = fresh();
  stored[ip] = "a.example.org";
  script.resolvePtr[ptrName(ip)] = ok("b.example.org", "a.example.org");
  script.resolve4["a.example.org"] = ok("192.0.2.9");
  script.resolve4["b.example.org"] = ok(ip);
  const [result] = await reverseMany([ip]);
  // a.example.org is still published, so it is an alternative — not "out of date".
  check(shape(result), { hostname: "b.example.org", source: "live", storedHostname: null, verdict: "confirmed" }, "a different confirming name is labelled live, not 'agree'");
  check(result.alternatives.map((alt) => [alt.name, alt.verdict]), [["a.example.org", "mismatch"]], "and the stored name appears as a published alternative");
}
{
  // Third review: the verdict used to depend on the order DNS listed the names in.
  for (const order of [["a.example.org", "b.example.org"], ["b.example.org", "a.example.org"]]) {
    reset();
    const ip = fresh();
    stored[ip] = null;
    script.resolvePtr[ptrName(ip)] = ok(...order);
    script.resolve4["a.example.org"] = ok("192.0.2.9");
    script.resolve4["b.example.org"] = fail("ETIMEOUT");
    // The name exists — it just has no IPv6. (An unscripted family answers
    // NXDOMAIN, which would rightly make b a name that does not exist.)
    script.resolve6["b.example.org"] = fail("ENODATA");
    const [result] = await reverseMany([ip]);
    check(result.verdict, "inconclusive", `an unchecked name keeps the question open, in order ${order.join(", ")}`);
  }
}

// --- one family failing --------------------------------------------------
{
  reset();
  const ip = fresh();
  stored[ip] = null;
  script.resolvePtr[ptrName(ip)] = ok("dual.example.org");
  script.resolve4["dual.example.org"] = fail("ETIMEOUT");
  script.resolve6["dual.example.org"] = ok("2001:db8::1");
  const [result] = await reverseMany([ip]);
  check(result.verdict, "inconclusive", "the address's own family timing out is not a mismatch");
}

// --- deadlines -----------------------------------------------------------
{
  reset();
  const ip = fresh();
  stored[ip] = "old.example.org";
  script.resolvePtr[ptrName(ip)] = ok("new.example.org");
  script.resolve4["new.example.org"] = hang;
  script.resolve6["new.example.org"] = hang;
  script.resolve4["old.example.org"] = ok("192.0.2.200");
  const [result] = await reverseMany([ip], Date.now() + 300);
  check(shape(result), { hostname: "new.example.org", source: "live", storedHostname: "old.example.org", verdict: "inconclusive" }, "out of time: the live name is kept, not the stale stored one");
}
{
  reset();
  const ip = fresh();
  stored[ip] = "old.example.org";
  script.resolvePtr[ptrName(ip)] = fail("ENOTFOUND");
  script.resolve4["old.example.org"] = hang;
  script.resolve6["old.example.org"] = hang;
  const [result] = await reverseMany([ip], Date.now() + 300);
  check(shape(result), { hostname: null, source: null, storedHostname: "old.example.org", verdict: "none" }, "a definite 'no PTR' is not lost waiting on a stored name");
}
{
  reset();
  const ips = Array.from({ length: 50 }, fresh);
  for (const ip of ips) {
    stored[ip] = null;
    script.resolvePtr[ptrName(ip)] = hang;
  }
  const deadline = Date.now() + 300;
  const started = Date.now();
  const results = await reverseMany(ips, deadline);
  check(results.length, 50, "a full list of 50 all comes back");
  check(Date.now() - started < 1000, true, "inside the deadline");
  check(calls.filter((call) => call.at >= deadline).length, 0, "no DNS query is started after the deadline");
  check(results.every((result) => result.verdict === "inconclusive"), true, "every unanswered row says 'could not check'");
}

// --- hostname mode -------------------------------------------------------
{
  reset();
  script.resolve4["mx.example.org"] = fail("ETIMEOUT");
  script.resolve6["mx.example.org"] = ok("2600:1f18::1");
  const report = await reverseHostname("mx.example.org");
  check(report.forward.status === "resolved" && report.forward.failedFamilies, ["v4"], "a missing IPv4 family is reported to the page");
}
{
  reset();
  script.resolve4["slow.example.org"] = hang;
  script.resolve6["slow.example.org"] = hang;
  const started = Date.now();
  const report = await reverseHostname("slow.example.org", Date.now() + 300);
  check(report.forward.status, "failed", "a hanging hostname lookup is cut off");
  check(Date.now() - started < 1000, true, "and the request ends at the deadline");
}


// --- configuration --------------------------------------------------------
check(validServers("1.1.1.1,8.8.8.8"), ["1.1.1.1", "8.8.8.8"], "valid retry servers are kept");
check(validServers("1.1.1.1:53, [2606:4700:4700::1111]:53"), ["1.1.1.1:53", "[2606:4700:4700::1111]:53"], "ports and bracketed IPv6 are fine");
check(validServers("x,1.1.1.1#53,dns.google,8.8.8.8"), ["8.8.8.8"], "a malformed entry is dropped, not allowed to crash every lookup");
check(validServers(""), [], "empty means retry through the system resolver");

// --- internal addresses are never shown ------------------------------------
{
  reset();
  script.resolve4["mixed.example.org"] = ok("10.0.0.5", "198.51.101.250");
  script.resolve6["mixed.example.org"] = ok("::1");
  const report = await reverseHostname("mixed.example.org");
  check(report.forward.status === "resolved" && report.forward.addresses, ["198.51.101.250"], "private and loopback answers are filtered out");
  check(report.forward.status === "resolved" && report.forward.hidden, 2, "and counted");
  check(report.results.map((result) => result.ip), ["198.51.101.250"], "only the public address is looked up");
}

// --- nothing new starts after the deadline ------------------------------------
{
  // The PTR query fails just after the deadline; its retry must not be sent.
  reset();
  const ip = fresh();
  stored[ip] = null;
  script.resolvePtr[ptrName(ip)] = after(150, fail("ETIMEOUT"));
  const deadline = Date.now() + 100;
  await reverseMany([ip], deadline);
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(calls.filter((call) => call.at >= deadline).length, 0, "a retry is not started once the deadline has passed");
}
{
  // A late PTR answer must not set off forward checks whose answers are discarded.
  reset();
  const ip = fresh();
  stored[ip] = null;
  script.resolvePtr[ptrName(ip)] = after(150, ok("late-1.example.org", "late-2.example.org"));
  const deadline = Date.now() + 100;
  await reverseMany([ip], deadline);
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(calls.filter((call) => call.method !== "resolvePtr").length, 0, "no forward check starts after the deadline");
}

// --- a stored-only crawler name is never "fake" --------------------------------
{
  reset();
  const ip = fresh();
  stored[ip] = "crawl-198-51-101-99.googlebot.com";
  script.resolvePtr[ptrName(ip)] = fail("ETIMEOUT");
  script.resolve4["crawl-198-51-101-99.googlebot.com"] = fail("ENOTFOUND");
  const [result] = await reverseMany([ip]);
  check([result.source, result.identity?.status], ["ipgeolocation", "unverified"], "live DNS never published it, so it is unverified, not fake");
}


// --- the API letting us down does not stop the live answer -------------------
for (const mode of ["error", "hang"] as const) {
  reset();
  apiMode = mode;
  const ip = fresh();
  stored[ip] = "stored.example.org";
  script.resolvePtr[ptrName(ip)] = ok("live.example.org");
  script.resolve4["live.example.org"] = ok(ip);
  const started = Date.now();
  const [result] = await reverseMany([ip], Date.now() + 1200);
  check([result.hostname, result.verdict, result.error], ["live.example.org", "confirmed", null], `API ${mode}: live DNS still gives the full answer`);
  check(typeof result.apiProblem === "string" && result.apiProblem.includes("live DNS alone"), true, `API ${mode}: and the page is told why there are no network details`);
  check(Date.now() - started < 1200, true, `API ${mode}: inside the deadline`);
  apiMode = "ok";
}
{
  reset();
  apiMode = "error";
  const ip = fresh();
  script.resolvePtr[ptrName(ip)] = fail("ETIMEOUT");
  const [result] = await reverseMany([ip]);
  check([result.verdict, result.error === null], ["inconclusive", true], "API down and PTR silent: 'could not check', not a hard failure");
  apiMode = "ok";
}


// --- more PTR names than are checked -----------------------------------------
{
  reset();
  const ip = fresh();
  stored[ip] = null;
  const names = Array.from({ length: 12 }, (_, i) => `n${i}.example.org`);
  script.resolvePtr[ptrName(ip)] = ok(...names);
  for (const name of names) script.resolve4[name] = ok("192.0.2.77");
  const [result] = await reverseMany([ip]);
  check([result.verdict, result.omittedNames], ["inconclusive", 2], "unchecked names keep a failing answer open, and are counted");
}

console.log(`lookup: ${checks} assertions passed`);
