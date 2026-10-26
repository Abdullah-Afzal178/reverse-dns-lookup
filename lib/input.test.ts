import assert from "node:assert/strict";

import { MAX_BULK, MAX_INPUT, extractHost, parseHostname, parseQuery } from "@/lib/input";

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

// --- empty -------------------------------------------------------------
check(parseQuery(""), { kind: "empty" }, "empty input");
check(parseQuery("   \n  "), { kind: "empty" }, "whitespace only");

// --- one IP ------------------------------------------------------------
check(parseQuery("8.8.8.8"), { kind: "ip", ip: "8.8.8.8" }, "one IPv4");
check(parseQuery("  8.8.8.8  "), { kind: "ip", ip: "8.8.8.8" }, "trimmed");
check(parseQuery("2606:4700:4700:0:0:0:0:1111"), { kind: "ip", ip: "2606:4700:4700::1111" }, "IPv6 is canonicalised");
check(parseQuery("[2606:4700::1111]"), { kind: "ip", ip: "2606:4700::1111" }, "brackets stripped");
check(parseQuery("8.8.8.8\n8.8.8.8"), { kind: "ip", ip: "8.8.8.8" }, "a list of one repeated address is a single lookup");

// --- a list ------------------------------------------------------------
{
  const result = parseQuery("8.8.8.8, 1.1.1.1\n2606:4700:4700::1111; 9.9.9.9");
  check(result.kind, "ips", "several addresses make a list");
  check(
    result.kind === "ips" && result.ips,
    ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "9.9.9.9"],
    "commas, newlines and semicolons all separate",
  );
}
{
  const result = parseQuery("8.8.8.8 8.8.8.8 2606:4700:4700::1111 2606:4700:4700:0:0:0:0:1111");
  check(result.kind === "ips" && result.ips, ["8.8.8.8", "2606:4700:4700::1111"], "duplicates collapse, in any spelling");
  check(result.kind === "ips" && result.duplicates, 2, "and are counted");
  check(result.kind === "ips" && result.respelled, 1, "one of them was the same IPv6 address spelled differently");
}
{
  const plain = parseQuery("8.8.8.8, 8.8.8.8, 1.1.1.1");
  check(plain.kind === "ips" && [plain.duplicates, plain.respelled], [1, 0], "a plain IPv4 repeat is not a respelling");
}
{
  const result = parseQuery("8.8.8.8 not-an-ip 1.1.1.1 999.1.1.1");
  check(result.kind === "ips" && result.ips, ["8.8.8.8", "1.1.1.1"], "valid addresses are kept");
  check(result.kind === "ips" && result.rejected, ["not-an-ip", "999.1.1.1"], "invalid tokens are reported, not swallowed");
}
{
  const many = Array.from({ length: MAX_BULK + 7 }, (_, index) => `10.0.${Math.floor(index / 256)}.${index % 256}`).join("\n");
  const result = parseQuery(many);
  check(result.kind === "ips" && result.ips.length, MAX_BULK, "a list is capped");
  check(result.kind === "ips" && result.overflow, 7, "and the cut is counted, never silent");
}
check(parseQuery("foo bar baz").kind, "invalid", "a list with no addresses is invalid");
{
  const phrase = parseQuery("what is this");
  check(
    phrase.kind === "invalid" && phrase.reason.startsWith("That is not an IP address, a hostname, or a list"),
    true,
    "a phrase is told what is accepted, not that it is a bad list",
  );
}

// --- a hostname --------------------------------------------------------
check(parseQuery("dns.google"), { kind: "hostname", hostname: "dns.google" }, "a bare hostname");
check(parseQuery("Mail.Example.COM."), { kind: "hostname", hostname: "mail.example.com" }, "lowercased, root dot dropped");
check(parseQuery("https://www.example.com/path?q=1"), { kind: "hostname", hostname: "www.example.com" }, "a URL reduces to its host");
check(parseQuery("example.com:25"), { kind: "hostname", hostname: "example.com" }, "a port is dropped");
check(parseQuery("_dmarc.example.com"), { kind: "hostname", hostname: "_dmarc.example.com" }, "underscore labels are allowed");

check(parseHostname("localhost"), null, "a single label is not a hostname");
check(parseHostname("-bad.com"), null, "a label cannot start with a hyphen");
check(parseHostname("bad-.com"), null, "a label cannot end with a hyphen");
check(parseHostname("1.2.3.999"), null, "a numeric last label is a malformed IP");
check(parseHostname(`${"a".repeat(64)}.com`), null, "a 64-character label is too long");
check(parseHostname("exa mple.com"), null, "spaces are not allowed");
check(parseQuery("what is this").kind, "invalid", "a sentence is not a hostname or a list of IPs");
check(parseQuery("localhost").kind, "invalid", "localhost is not resolvable public DNS");

// --- length: never cut mid-token -----------------------------------------
{
  // A repetitive log just past the old 4000-character cut, which used to split
  // "9.9.9.10" into "9.9.9.1" — an address nobody typed.
  const log = `${"1.1.1.1\n".repeat(499)}\n9.9.9.10\n8.8.4.4\n208.67.222.222`;
  const result = parseQuery(log);
  check(result.kind === "ips" && result.ips, ["1.1.1.1", "9.9.9.10", "8.8.4.4", "208.67.222.222"], "every address survives, none is invented");
  check(result.kind === "ips" && result.duplicates, 498, "the duplicates are still counted");
}
check(parseQuery("8.8.8.8 ".repeat(Math.ceil((MAX_INPUT + 10) / 8))).kind, "invalid", "absurdly long input is refused outright, not truncated");

// --- IP literals wrapped in a URL or carrying a port ----------------------
check(parseQuery("https://8.8.8.8/"), { kind: "ip", ip: "8.8.8.8" }, "an IP in a URL");
check(parseQuery("8.8.8.8:53"), { kind: "ip", ip: "8.8.8.8" }, "an IP with a port");
check(parseQuery("[2001:4860:4860::8888]:443"), { kind: "ip", ip: "2001:4860:4860::8888" }, "a bracketed IPv6 with a port");
check(parseQuery("http://[2606:4700:4700::1111]/dns-query"), { kind: "ip", ip: "2606:4700:4700::1111" }, "a bracketed IPv6 in a URL");
check(parseQuery("2606:4700:4700::1111"), { kind: "ip", ip: "2606:4700:4700::1111" }, "a bare IPv6 is not mistaken for host:port");
{
  const result = parseQuery("8.8.8.8:53\nhttps://1.1.1.1/");
  check(result.kind === "ips" && result.ips, ["8.8.8.8", "1.1.1.1"], "wrapped addresses work inside a list too");
}
check(extractHost("user:pw@example.com:8080/path"), "example.com", "userinfo, port and path all go");

// --- a URL whose path contains separators -------------------------------
check(parseQuery("https://www.google.com/maps/@40.7,-74.0,12z"), { kind: "hostname", hostname: "www.google.com" }, "commas in a URL path do not split it");
check(parseQuery("https://example.com/?a=1;b=2"), { kind: "hostname", hostname: "example.com" }, "semicolons in a query do not split it");

// --- internationalised names --------------------------------------------
check(parseQuery("münchen.de"), { kind: "hostname", hostname: "xn--mnchen-3ya.de" }, "an IDN becomes its punycode form");
check(parseQuery("bücher.example"), { kind: "hostname", hostname: "xn--bcher-kva.example" }, "another IDN");
check(parseQuery("xn--mnchen-3ya.de"), { kind: "hostname", hostname: "xn--mnchen-3ya.de" }, "punycode typed directly still works");


// --- a URL at the head of a list does not swallow it ---------------------
{
  const result = parseQuery("https://1.1.1.1/,8.8.8.8,9.9.9.9");
  check(result.kind === "ips" && result.ips, ["1.1.1.1", "8.8.8.8", "9.9.9.9"], "a leading URL and the addresses after it");
  const urls = parseQuery("http://8.8.8.8,http://1.1.1.1");
  check(urls.kind === "ips" && urls.ips, ["8.8.8.8", "1.1.1.1"], "a comma-joined list of URLs");
  check(parseQuery("https://www.google.com/maps/@40.7,-74.0,12z").kind, "hostname", "a URL whose commas are part of the path stays one URL");
}


// --- ranges are reported, never narrowed to their first address ---------
{
  const single = parseQuery("45.33.0.0/16");
  check(single.kind === "invalid" && single.reason.startsWith("That is a range"), true, "a lone range is refused with a reason");
  check(parseQuery("2001:db8::/32").kind, "invalid", "an IPv6 range too");
  const mixed = parseQuery("1.2.3.0/24\n8.8.8.8\n9.9.9.9");
  check(mixed.kind === "ips" && mixed.ips, ["8.8.8.8", "9.9.9.9"], "a range in a list is not looked up as its network address");
  check(mixed.kind === "ips" && mixed.ranges, ["1.2.3.0/24"], "and is reported");
  const onlyRanges = parseQuery("1.2.3.0/24, 10.0.0.0/8");
  check(onlyRanges.kind === "invalid" && onlyRanges.reason.startsWith("Those are ranges"), true, "a list of only ranges is refused with a reason");
  check(parseQuery("https://8.8.8.8/24"), { kind: "ip", ip: "8.8.8.8" }, "a URL path that looks like a prefix is still a URL");
}

// --- commas inside a URL's query string ----------------------------------
check(parseQuery("https://example.com/?q=1.1.1.1,8.8.8.8"), { kind: "hostname", hostname: "example.com" }, "commas in a query string do not split the URL");
check(parseQuery("https://8.8.8.8/?ips=1.1.1.1,9.9.9.9"), { kind: "ip", ip: "8.8.8.8" }, "not even when the host is an IP");
check(parseQuery("http://1.1.1.1/x;y").kind, "ip", "a semicolon in the path of an IP URL keeps it whole");
{
  const list = parseQuery("https://1.1.1.1/,8.8.8.8,9.9.9.9");
  check(list.kind === "ips" && list.ips, ["1.1.1.1", "8.8.8.8", "9.9.9.9"], "a real list that starts with a URL is still a list");
}

console.log(`input: ${checks} assertions passed`);
