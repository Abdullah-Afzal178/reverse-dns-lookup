/**
 * IP parsing and canonical form. Pure and dependency-free.
 *
 * Canonical form matters more than it looks: the bulk API returns IPv6
 * expanded ("2606:4700:4700:0:0:0:0:1111"), the resolver returns it
 * compressed ("2606:4700:4700::1111"), and a visitor may type either. Every
 * equality check in this tool goes through canonicalIp() so all three agree.
 */

export function isIpv4(value: string): boolean {
  const parts = value.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }

    // Reject "01": some parsers read a leading zero as octal.
    if (part.length > 1 && part.startsWith("0")) {
      return false;
    }

    return Number.parseInt(part, 10) <= 255;
  });
}

/** Eight 16-bit groups, or null when the text is not IPv6. */
export function ipv6Groups(value: string): number[] | null {
  if (!value.includes(":") || value.includes(":::") || /[^0-9a-f:.]/i.test(value)) {
    return null;
  }

  if (value.split("::").length > 2) {
    return null;
  }

  const compressed = value.includes("::");
  const [head, tail = ""] = value.split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === "" ? [] : tail.split(":");

  // A trailing dotted quad (::ffff:192.0.2.1) stands for the last two groups.
  const lastIndex = tailParts.length > 0 ? tailParts.length - 1 : -1;
  const last = compressed ? tailParts[lastIndex] : headParts[headParts.length - 1];
  const embedded: number[] = [];

  if (last !== undefined && last.includes(".")) {
    if (!isIpv4(last)) {
      return null;
    }

    const octets = last.split(".").map((part) => Number.parseInt(part, 10));
    embedded.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);

    if (compressed) {
      tailParts.pop();
    } else {
      headParts.pop();
    }
  }

  const parse = (parts: string[]) => {
    const groups: number[] = [];

    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) {
        return null;
      }

      groups.push(Number.parseInt(part, 16));
    }

    return groups;
  };

  const headGroups = parse(headParts);
  const tailGroups = parse(tailParts);

  if (!headGroups || !tailGroups) {
    return null;
  }

  const explicit = headGroups.length + tailGroups.length + embedded.length;

  if (compressed) {
    // "::" must stand for at least one group.
    if (explicit > 7) {
      return null;
    }

    return [...headGroups, ...Array(8 - explicit).fill(0), ...tailGroups, ...embedded];
  }

  return explicit === 8 ? [...headGroups, ...tailGroups, ...embedded] : null;
}

export function isIpv6(value: string): boolean {
  return ipv6Groups(value) !== null;
}

export function isIp(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

/**
 * One spelling per address: IPv4 as-is, IPv6 lowercased and compressed per
 * RFC 5952 (the longest run of two or more zero groups becomes "::", leftmost
 * on a tie). An IPv4-mapped IPv6 address collapses to its IPv4 form, since
 * that is how the resolver will report it.
 */
export function canonicalIp(value: string): string | null {
  const text = value.trim().replace(/^\[|\]$/g, "");

  if (isIpv4(text)) {
    return text;
  }

  const groups = ipv6Groups(text);

  if (!groups) {
    return null;
  }

  // ::ffff:a.b.c.d
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }

  let bestStart = -1;
  let bestLength = 0;

  for (let index = 0; index < 8; ) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }

    let end = index;

    while (end < 8 && groups[end] === 0) {
      end += 1;
    }

    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }

    index = end;
  }

  const hex = groups.map((group) => group.toString(16));

  if (bestLength < 2) {
    return hex.join(":");
  }

  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLength).join(":");

  return `${head}::${tail}`;
}

export function sameIp(a: string, b: string): boolean {
  const left = canonicalIp(a);
  const right = canonicalIp(b);

  return left !== null && left === right;
}

/**
 * Private, loopback, link-local, CGNAT, multicast and reserved space. These
 * have no public reverse DNS, and the API answers them with HTTP 423, so they
 * are caught up front with a clearer message.
 */
export function isNonPublicIp(value: string): boolean {
  const ip = canonicalIp(value);

  if (!ip) {
    return false;
  }

  if (isIpv4(ip)) {
    const [a, b] = ip.split(".").map((part) => Number.parseInt(part, 10));

    const c = Number.parseInt(ip.split(".")[2], 10);

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF assignments, TEST-NET-1
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      // Reserved and broadcast. Not 224.0.0.0/4: multicast is special-purpose,
      // but mcast.net publishes real, forward-confirming PTRs for it.
      a >= 240
    );
  }

  const groups = ipv6Groups(ip) ?? [];
  const first = groups[0] ?? 0;

  // Only 2000::/3 is globally routed unicast. Everything outside it — loopback,
  // unique-local, link-local, site-local, multicast, the discard prefix,
  // NAT64 — has no public reverse DNS.
  if ((first & 0xe000) !== 0x2000) {
    return true;
  }

  return (
    (first === 0x2001 && groups[1] === 0x0db8) || // 2001:db8::/32 documentation
    (first === 0x3fff && (groups[1] & 0xf000) === 0) // 3fff::/20 documentation (RFC 9637)
  );
}

/**
 * The DNS name a PTR record lives at: 4.3.2.1.in-addr.arpa for 1.2.3.4, and
 * the address's 32 nibbles reversed under ip6.arpa for IPv6.
 *
 * Querying this name directly (resolvePtr) is what gives honest error codes.
 * Node's dns.reverse() goes through gethostbyaddr, which reports a timeout,
 * SERVFAIL and REFUSED all as ENOTFOUND — indistinguishable from "no PTR".
 */
export function reverseName(value: string): string | null {
  const ip = canonicalIp(value);

  if (!ip) {
    return null;
  }

  if (isIpv4(ip)) {
    return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  }

  const groups = ipv6Groups(ip);

  if (!groups) {
    return null;
  }

  const nibbles = groups.map((group) => group.toString(16).padStart(4, "0")).join("").split("");

  return `${nibbles.reverse().join(".")}.ip6.arpa`;
}

/** 224.0.0.0/4. Live DNS can answer for it; ipgeolocation.io has no data for it. */
export function isMulticastV4(value: string): boolean {
  const ip = canonicalIp(value);

  return ip !== null && isIpv4(ip) && Number.parseInt(ip.split(".")[0], 10) >= 224 && Number.parseInt(ip.split(".")[0], 10) <= 239;
}
