/**
 * Decides what was typed: one IP, a list of IPs, or a hostname whose
 * addresses should be checked in reverse. Pure, so it can be unit tested.
 */

import { canonicalIp, isIp } from "@/lib/ip";

/** One bulk API call; also keeps the forward lookups that follow bounded. */
export const MAX_BULK = 50;

/**
 * A sanity bound, not a cut. Text is never sliced mid-token: slicing
 * "9.9.9.10" at the wrong character silently looks up 9.9.9.1 instead.
 * Node rejects request lines much longer than this anyway.
 */
export const MAX_INPUT = 16000;

export type ParsedQuery =
  | { kind: "empty" }
  | { kind: "ip"; ip: string }
  | {
      kind: "ips";
      ips: string[];
      /** Tokens that were not IP addresses, reported rather than dropped silently. */
      rejected: string[];
      /** Duplicates collapsed, counted so the total still adds up. */
      duplicates: number;
      /** How many of those were the same IPv6 address spelled differently. */
      respelled: number;
      /** CIDR ranges, which have no single PTR record — reported, not narrowed. */
      ranges: string[];
      /** Addresses past MAX_BULK, counted rather than silently ignored. */
      overflow: number;
    }
  | { kind: "hostname"; hostname: string }
  | { kind: "invalid"; reason: string };

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function parseQuery(raw: string): ParsedQuery {
  const text = raw.trim();

  if (text === "") {
    return { kind: "empty" };
  }

  if (text.length > MAX_INPUT) {
    return {
      kind: "invalid",
      reason: `That is too long to look up in one go. Paste up to ${MAX_BULK} addresses at a time.`,
    };
  }

  // A single URL stays whole when its commas or semicolons belong to it — in
  // its query string or fragment, or anywhere the pieces would not all be
  // addresses. Otherwise "https://1.1.1.1/,8.8.8.8" is a list of two.
  const split = text.split(/[\s,;]+/).filter(Boolean);
  const firstSeparator = text.search(/[,;]/);
  const queryStart = text.search(/[?#]/);
  const separatorInsideUrl = queryStart !== -1 && firstSeparator > queryStart;
  const isList = split.length > 1 && split.every((token) => isIp(extractHost(token)));
  const tokens = URL_PATTERN.test(text) && (separatorInsideUrl || !isList) ? [text] : split;

  if (tokens.length === 1) {
    if (isRange(tokens[0])) {
      return {
        kind: "invalid",
        reason: "That is a range. Reverse DNS is published per address, so paste the individual addresses you want checked.",
      };
    }

    const host = extractHost(tokens[0]);

    if (isIp(host)) {
      return { kind: "ip", ip: canonicalIp(host) ?? host };
    }

    const hostname = parseHostname(tokens[0]);

    if (hostname) {
      return { kind: "hostname", hostname };
    }

    return {
      kind: "invalid",
      reason: "That is neither an IP address nor a hostname. Try 8.8.8.8 or mail.example.com.",
    };
  }

  // The first spelling seen for each address, to tell a repeat from a respelling.
  const seen = new Map<string, string>();
  const ips: string[] = [];
  const rejected: string[] = [];
  const ranges: string[] = [];
  let duplicates = 0;
  let respelled = 0;
  let overflow = 0;

  for (const token of tokens) {
    if (isRange(token)) {
      ranges.push(token.slice(0, 64));
      continue;
    }

    const host = extractHost(token);
    const ip = isIp(host) ? canonicalIp(host) : null;

    if (!ip) {
      rejected.push(token.slice(0, 64));
      continue;
    }

    const first = seen.get(ip);

    if (first !== undefined) {
      duplicates += 1;

      if (first.toLowerCase() !== host.toLowerCase()) {
        respelled += 1;
      }

      continue;
    }

    seen.set(ip, host);

    if (ips.length >= MAX_BULK) {
      overflow += 1;
      continue;
    }

    ips.push(ip);
  }

  if (ips.length === 0 && ranges.length > 0 && rejected.length === 0) {
    return {
      kind: "invalid",
      reason: "Those are ranges. Reverse DNS is published per address, so paste the individual addresses you want checked.",
    };
  }

  if (ips.length === 0) {
    // Several words with no address among them is usually a phrase, not a
    // list — so say what is accepted rather than implying a list was meant.
    return {
      kind: "invalid",
      reason:
        "That is not an IP address, a hostname, or a list of addresses. Try 8.8.8.8, mail.example.com, or one address per line.",
    };
  }

  // A list that boiled down to one address is still a single lookup.
  if (ips.length === 1 && rejected.length === 0 && ranges.length === 0 && overflow === 0) {
    return { kind: "ip", ip: ips[0] };
  }

  return { kind: "ips", ips, rejected, duplicates, respelled, ranges, overflow };
}

/** "45.33.0.0/16" or "2001:db8::/32" — a CIDR range, not an address. */
function isRange(token: string): boolean {
  if (SCHEME.test(token)) {
    return false;
  }

  const match = token.match(/^([0-9a-f.:]+)\/(\d{1,3})$/i);

  return match !== null && isIp(match[1]);
}

/**
 * The host part of anything pasted: drops a scheme, userinfo, path, query,
 * brackets around IPv6, and a port. "https://8.8.8.8/x" and "[2001:db8::1]:443"
 * both come out as a bare address.
 */
export function extractHost(value: string): string {
  let text = value.trim();

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  text = text.split(/[/?#]/)[0];
  text = text.replace(/^[^@]*@/, "");

  const bracketed = text.match(/^\[([^\]]+)\](?::\d+)?$/);

  if (bracketed) {
    return bracketed[1];
  }

  // host:port only when there is exactly one colon — a bare IPv6 has several.
  if ((text.match(/:/g) ?? []).length === 1) {
    text = text.replace(/:\d+$/, "");
  }

  return text;
}

/**
 * Accepts "mail.example.com", "https://example.com/path", "example.com:25",
 * a trailing root dot, and internationalised names ("münchen.de" becomes its
 * punycode form, which is what DNS actually holds). Null for anything else.
 */
export function parseHostname(value: string): string | null {
  let text = extractHost(value).toLowerCase().replace(/\.$/, "");

  if (text.length === 0 || !text.includes(".")) {
    return null;
  }

  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(text)) {
    try {
      // The WHATWG URL parser applies IDNA, the same conversion browsers use.
      text = new URL(`http://${text}`).hostname;
    } catch {
      return null;
    }
  }

  if (text.length > 253) {
    return null;
  }

  const labels = text.split(".");
  const labelPattern = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;

  if (!labels.every((label) => labelPattern.test(label))) {
    return null;
  }

  // An all-numeric last label means a malformed IP, not a hostname.
  if (/^\d+$/.test(labels[labels.length - 1])) {
    return null;
  }

  return text;
}
