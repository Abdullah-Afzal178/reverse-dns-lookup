import assert from "node:assert/strict";

import { embedsIp, operatorDomain, readAnatomy } from "@/lib/anatomy";

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}
const kinds = (hostname: string, ip: string) => readAnatomy(hostname, ip).hints.map((hint) => hint.kind);
const labels = (hostname: string, ip: string) => readAnatomy(hostname, ip).hints.map((hint) => hint.label);

// --- operator domain ---------------------------------------------------
const od = (host: string) => operatorDomain(host);
check(od("c-73-162-0-1.hsd1.ca.comcast.net"), { domain: "comcast.net", certain: true }, "a long ISP name");
check(od("dns.google"), { domain: "dns.google", certain: true }, "two labels stay as they are");
check(od("host81-152-0-1.range81-152.btcentralplus.com").domain, "btcentralplus.com", "BT");
check(od("cpc1-brig1-2-0-cust1.3-3.cable.virginm.net").domain, "virginm.net", "Virgin Media");
check(od("host.example.co.uk"), { domain: "example.co.uk", certain: true }, "a listed two-part suffix keeps three labels");
check(od("a.b.ne.jp").domain, "b.ne.jp", "a Japanese ISP suffix");
check(od("EXAMPLE.COM").domain, "example.com", "lowercased");
// Fourth review: these used to read "run by net.co" and "run by net.il".
check(od("avas1.une.net.co"), { domain: "une.net.co", certain: true }, "a generic second level under a country code");
check(od("custmx.netvision.net.il"), { domain: "netvision.net.il", certain: true }, "net.il");
check(od("mail.kyivstar.com.ua").domain, "kyivstar.com.ua", "com.ua");
check(od("host.isp.co.th").domain, "isp.co.th", "co.th");
// A regional suffix cannot be told from a registrable domain without the full list.
check(od("out12.mi6.kiev.ua"), { domain: "kiev.ua", certain: false }, "an unrecognised country second level is named, not trusted");
check(od("www.google.de"), { domain: "google.de", certain: false }, "which errs on the side of not claiming an operator");
check(od("mail.example.com"), { domain: "example.com", certain: true }, "a generic TLD is certain");

// --- embedded addresses -------------------------------------------------
check(embedsIp("c-73-162-0-1.hsd1.ca.comcast.net", "73.162.0.1"), true, "dashed");
check(embedsIp("ec2-3-80-0-1.compute-1.amazonaws.com", "3.80.0.1"), true, "dashed inside a cloud name");
check(embedsIp("1.0.162.73.in-addr.example.net", "73.162.0.1"), true, "reversed and dotted");
check(embedsIp("1-0-162-73.static.example.net", "73.162.0.1"), true, "reversed and dashed");
check(embedsIp("host073162000001.example.net", "73.162.0.1"), true, "zero-padded and run together");
check(embedsIp("ip-49a20001.example.net", "73.162.0.1"), true, "as hex");
check(embedsIp("11-1-1-15.example.net", "1.1.1.1"), false, "digit boundaries stop a false match");
check(embedsIp("one.one.one.one", "1.1.1.1"), false, "a spelled-out name is not the address");
check(embedsIp("dns.google", "8.8.8.8"), false, "no address in a service name");
check(embedsIp("2001-db8-1--5.example.net", "2001:db8:1::5"), true, "IPv6 compressed, colons as dashes");
check(embedsIp("crawl-2001-4860-4801-0010-0000-0000-0000-0005.googlebot.com", "2001:4860:4801:10::5"), true, "IPv6 fully padded, as Googlebot writes it");
check(embedsIp("host-2001-db8-1-0-0-0-0-5.example.net", "2001:db8:1::5"), true, "IPv6 expanded but unpadded");
check(embedsIp("v6-20010db8000100000000000000000005.example.net", "2001:db8:1::5"), true, "IPv6 as 32 hex digits");
check(embedsIp("2001-db8-1--55.example.net", "2001:db8:1::5"), false, "a hex boundary stops a longer group from matching");
check(readAnatomy("crawl-2001-4860-4801-0010-0000-0000-0000-0005.googlebot.com", "2001:4860:4801:10::5").hints[0]?.kind, "generic", "the IPv6 Googlebot name is recognised as generated");
check(embedsIp("anything", "not-an-ip"), false, "an invalid address embeds nothing");

// --- connection type ---------------------------------------------------
check(labels("c-73-162-0-1.hsd1.ca.comcast.net", "73.162.0.1"), ["Generated from the address", "Cable broadband"], "Comcast cable");
check(labels("adsl-1-2-3-4.dsl.example.net", "1.2.3.4").includes("DSL broadband"), true, "DSL");
check(labels("1-2-3-4.dynamic.example.net", "1.2.3.4").includes("Dynamic address"), true, "dynamic pool");
check(labels("pool-1-2-3-4.example.net", "1.2.3.4").includes("Dynamic address"), true, "pool- prefix");
check(labels("1-2-3-4.static.example.net", "1.2.3.4").includes("Static address"), true, "static");
check(labels("1-2-3-4.ftth.example.net", "1.2.3.4").includes("Fibre broadband"), true, "fibre");
check(labels("1-2-3-4.mobile.example.net", "1.2.3.4").includes("Mobile network"), true, "mobile");
// The operator's own domain must not be read as a connection hint.
check(labels("www.cablelabs.com", "1.2.3.4"), [], "a brand containing 'cable' is not a cable line");
check(labels("mail.fiberhost.net", "1.2.3.4").includes("Fibre broadband"), false, "nor is a brand containing 'fiber'");
check(labels("dynamo.example.net", "1.2.3.4").includes("Dynamic address"), false, "'dynamo' is not 'dynamic'");

// --- cloud -------------------------------------------------------------
check(
  readAnatomy("ec2-3-80-0-1.compute-1.amazonaws.com", "3.80.0.1").hints.find((hint) => hint.kind === "cloud"),
  { kind: "cloud", label: "Amazon Web Services", detail: "EC2 instance in us-east-1" },
  "AWS us-east-1",
);
check(
  readAnatomy("ec2-1-2-3-4.eu-west-2.compute.amazonaws.com", "1.2.3.4").hints.find((hint) => hint.kind === "cloud")?.detail,
  "EC2 instance in eu-west-2",
  "AWS region read from the name",
);
check(
  readAnatomy("4.3.2.1.bc.googleusercontent.com", "1.2.3.4").hints.find((hint) => hint.kind === "cloud")?.label,
  "Google Cloud",
  "a GCP VM",
);
// Sixth review: Google's own crawler list includes some of these ranges.
check(
  readAnatomy("4.3.2.1.bc.googleusercontent.com", "1.2.3.4").hints.find((hint) => hint.kind === "cloud")?.detail.includes("not a Google crawler"),
  false,
  "a Compute Engine name is never flatly declared 'not a Google crawler'",
);
check(
  readAnatomy("myapp.westeurope.cloudapp.azure.com", "1.2.3.4").hints.find((hint) => hint.kind === "cloud")?.detail,
  "A cloud service in westeurope",
  "Azure region",
);
check(kinds("static.4.3.2.1.clients.your-server.de", "1.2.3.4").includes("cloud"), true, "Hetzner");
check(kinds("ns3001234.ip-1-2-3.eu", "1.2.3.4").includes("cloud"), true, "OVH");
check(kinds("dns.google", "8.8.8.8"), [], "a service host gets no hints");
check(kinds("ec2-3-80-0-1.compute-1.amazonaws.com", "3.80.0.1").filter((kind) => kind === "cloud").length, 1, "only one cloud is ever named");

// --- mail --------------------------------------------------------------
check(kinds("mail.example.com", "1.2.3.4").includes("mail"), true, "mail.");
check(kinds("mx1.example.com", "1.2.3.4").includes("mail"), true, "mx1.");
check(kinds("smtp-out.example.com", "1.2.3.4").includes("mail"), true, "smtp-");
check(kinds("mailbox-hosting.example.com", "1.2.3.4").includes("mail"), false, "'mailbox' is not a mail server name");
check(kinds("www.example.com", "1.2.3.4").includes("mail"), false, "www is not a mail server");

check(
  readAnatomy("1.192.178.107.gae.googleusercontent.com", "107.178.192.1").hints.find((hint) => hint.kind === "cloud")?.detail.includes("not Googlebot"),
  true,
  "an App Engine name is read as App Engine, not Googlebot",
);

console.log(`anatomy: ${checks} assertions passed`);
