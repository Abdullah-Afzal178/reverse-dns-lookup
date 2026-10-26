import assert from "node:assert/strict";

import { canonicalIp, ipv6Groups, isIp, isIpv4, isIpv6, isMulticastV4, isNonPublicIp, reverseName, sameIp } from "@/lib/ip";

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

// --- IPv4 --------------------------------------------------------------
check(isIpv4("8.8.8.8"), true, "plain IPv4");
check(isIpv4("0.0.0.0"), true, "all zeros");
check(isIpv4("255.255.255.255"), true, "all ones");
check(isIpv4("256.1.1.1"), false, "octet over 255");
check(isIpv4("1.1.1"), false, "three octets");
check(isIpv4("1.1.1.1.1"), false, "five octets");
check(isIpv4("01.1.1.1"), false, "octal-looking octet");
check(isIpv4("1.1.1.-1"), false, "negative octet");
check(isIpv4("1.1.1.a"), false, "letter octet");
check(isIpv4(""), false, "empty");

// --- IPv6 --------------------------------------------------------------
check(isIpv6("2606:4700:4700::1111"), true, "compressed");
check(isIpv6("2606:4700:4700:0:0:0:0:1111"), true, "expanded, as the bulk API returns it");
check(isIpv6("::"), true, "unspecified");
check(isIpv6("::1"), true, "loopback");
check(isIpv6("::ffff:192.0.2.1"), true, "IPv4-mapped");
check(isIpv6("64:ff9b::192.0.2.1"), true, "NAT64 with embedded IPv4");
check(isIpv6("1:2:3:4:5:6:7::"), true, ":: standing for one trailing group");
check(isIpv6("1:2:3:4:5:6:7:8"), true, "eight explicit groups");
check(isIpv6("1:2:3:4:5:6:7:8:9"), false, "nine groups");
check(isIpv6("1:2:3:4:5:6:7"), false, "seven groups with no ::");
check(isIpv6("1:2:3:4:5:6:7:8::"), false, ":: with nothing left to stand for");
check(isIpv6("2001::4860::1"), false, "two :: runs");
check(isIpv6("2001:::1"), false, "triple colon");
check(isIpv6("2001:gggg::1"), false, "non-hex group");
check(isIpv6("2001:12345::1"), false, "five hex digits in a group");
check(isIpv6("::ffff:999.0.2.1"), false, "bad embedded IPv4");
check(isIpv6("8.8.8.8"), false, "IPv4 is not IPv6");
check(isIp("dns.google"), false, "a hostname is not an IP");

// --- canonical form ----------------------------------------------------
check(canonicalIp("8.8.8.8"), "8.8.8.8", "IPv4 passes through");
check(canonicalIp(" 8.8.8.8 "), "8.8.8.8", "whitespace is trimmed");
check(canonicalIp("2606:4700:4700:0:0:0:0:1111"), "2606:4700:4700::1111", "expanded compresses");
check(canonicalIp("2606:4700:4700:0000:0000:0000:0000:1111"), "2606:4700:4700::1111", "zero-padded compresses");
check(canonicalIp("2606:4700:4700::1111"), "2606:4700:4700::1111", "already canonical is unchanged");
check(canonicalIp("2001:DB8::1"), "2001:db8::1", "hex is lowercased");
check(canonicalIp("[2606:4700::1111]"), "2606:4700::1111", "brackets are stripped");
check(canonicalIp("0:0:0:0:0:0:0:1"), "::1", "loopback compresses");
check(canonicalIp("0:0:0:0:0:0:0:0"), "::", "all zeros compresses to ::");
check(canonicalIp("2001:db8:0:1:0:0:0:1"), "2001:db8:0:1::1", "the longest zero run wins");
check(canonicalIp("2001:0:0:1:0:0:0:1"), "2001:0:0:1::1", "longest run beats the earlier, shorter one");
check(canonicalIp("2001:db8:0:0:1:0:0:1"), "2001:db8::1:0:0:1", "on a tie the leftmost run is compressed");
check(canonicalIp("2001:db8:0:1:1:1:1:1"), "2001:db8:0:1:1:1:1:1", "a single zero group is not compressed");
check(canonicalIp("::ffff:192.0.2.1"), "192.0.2.1", "IPv4-mapped collapses to IPv4");
check(canonicalIp("::ffff:c000:201"), "192.0.2.1", "IPv4-mapped written in hex collapses too");
check(canonicalIp("not an ip"), null, "junk has no canonical form");

// --- equality ----------------------------------------------------------
check(sameIp("2606:4700:4700:0:0:0:0:1111", "2606:4700:4700::1111"), true, "expanded equals compressed");
check(sameIp("2001:DB8::1", "2001:db8:0:0:0:0:0:1"), true, "case and form both ignored");
check(sameIp("::ffff:8.8.8.8", "8.8.8.8"), true, "mapped equals plain IPv4");
check(sameIp("8.8.8.8", "8.8.4.4"), false, "different addresses differ");
check(sameIp("junk", "junk"), false, "two invalid strings are never equal");

// --- non-public space --------------------------------------------------
for (const ip of [
  "10.0.0.1", "127.0.0.1", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254",
  "100.64.0.1", "0.0.0.0", "240.0.0.1", "255.255.255.255", "198.18.0.1",
  "192.0.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.5",
  "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "100::1", "64:ff9b::1.2.3.4",
  "2001:db8::1", "3fff::1", "3fff:fff::1", "::ffff:10.0.0.1",
]) {
  check(isNonPublicIp(ip), true, `${ip} is not public`);
}
for (const ip of [
  "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "192.0.1.1", "192.0.3.1", "198.51.101.1", "203.0.114.1",
  "2606:4700:4700::1111", "2a00:1450::1", "2001:4860:4860::8888", "2c0f:fb50::1", "3ff0::1", "3fff:1000::1",
]) {
  check(isNonPublicIp(ip), false, `${ip} is public`);
}
check(ipv6Groups("2001:db8::1"), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], "groups expand the :: run");
check(ipv6Groups("8.8.8.8"), null, "IPv4 has no IPv6 groups");


// --- PTR query names ---------------------------------------------------
check(reverseName("1.2.3.4"), "4.3.2.1.in-addr.arpa", "IPv4 octets reversed");
check(reverseName("8.8.8.8"), "8.8.8.8.in-addr.arpa", "a palindrome still works");
check(reverseName("::ffff:192.0.2.1"), "1.2.0.192.in-addr.arpa", "IPv4-mapped uses the IPv4 zone");
check(
  reverseName("2001:db8::567:89ab"),
  "b.a.9.8.7.6.5.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
  "the RFC 3596 example, nibble by nibble",
);
check(reverseName("2606:4700:4700::1111"), reverseName("2606:4700:4700:0:0:0:0:1111"), "every IPv6 spelling gives one name");
check(reverseName("2606:4700:4700::1111")?.split(".").length, 34, "32 nibbles plus ip6.arpa");
check(reverseName("dns.google"), null, "a hostname has no PTR name");


// --- multicast has public reverse DNS (mcast.net) ---------------------------
check(isNonPublicIp("224.0.0.251"), false, "multicast is not treated as having no public PTR");
check(isMulticastV4("224.0.0.251"), true, "mDNS is multicast");
check(isMulticastV4("239.255.255.250"), true, "the top of the multicast block");
check(isMulticastV4("240.0.0.1"), false, "240/4 is reserved, not multicast");
check(isMulticastV4("8.8.8.8"), false, "an ordinary address is not multicast");

console.log(`ip: ${checks} assertions passed`);
