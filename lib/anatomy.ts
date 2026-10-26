/**
 * Reads what a hostname gives away about the machine behind it: whether it
 * is an ISP's generated name, the kind of connection, the cloud and region it
 * runs in. Pure. Every hint is a heuristic, and the UI says so.
 */

import { canonicalIp, ipv6Groups, isIpv4 } from "@/lib/ip";

export type Hint = {
  kind: "generic" | "connection" | "cloud" | "mail";
  label: string;
  detail: string;
};

export type Anatomy = {
  domain: string;
  /**
   * False when the domain is a guess: a country domain whose second level is
   * not a recognised registry label might be a regional suffix (kiev.ua), so
   * the page names the domain without claiming who runs it.
   */
  domainCertain: boolean;
  embedsIp: boolean;
  hints: Hint[];
};

/**
 * A small set of two-part public suffixes. Not the full Public Suffix List:
 * enough to read "comcast.net" and "bt.co.uk" correctly, and the UI labels
 * the result as the operator's domain rather than claiming registry accuracy.
 */
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "net.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "ad.jp",
  "com.br", "net.br", "org.br",
  "com.cn", "net.cn", "org.cn",
  "co.in", "net.in", "org.in",
  "co.za", "com.mx", "com.ar", "com.tr", "com.sg", "com.hk", "com.tw",
  "co.kr", "or.kr", "ne.kr", "co.id", "net.id", "com.my", "com.ph", "com.vn", "com.pk", "net.pk",
]);

/**
 * Second-level labels that country registries use as categories: "net.co",
 * "com.ua", "co.th", "org.il". Under a two-letter country code, these mean
 * the registrable domain is one label further left.
 */
const GENERIC_SECOND_LEVELS = new Set([
  "com", "net", "org", "co", "ac", "edu", "gov", "go", "or", "ne", "mil", "gob", "nic", "ltd", "plc",
  "sch", "info", "biz", "gen", "nom", "res", "int", "web", "firm", "ind", "med", "pro", "tm", "ed",
  "gr", "lg", "ad", "nhs", "police", "mod", "asso", "presse", "inf", "art", "rec", "store", "or",
]);

export function operatorDomain(hostname: string): { domain: string; certain: boolean } {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);

  if (labels.length <= 2) {
    return { domain: labels.join("."), certain: true };
  }

  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const lastTwo = `${second}.${tld}`;
  const lastThree = labels.slice(-3).join(".");

  if (TWO_PART_SUFFIXES.has(lastTwo)) {
    return { domain: lastThree, certain: true };
  }

  const countryCode = /^[a-z]{2}$/.test(tld);

  if (countryCode && GENERIC_SECOND_LEVELS.has(second)) {
    return { domain: lastThree, certain: true };
  }

  // A country domain with an unrecognised second level is usually registrable
  // as it stands (google.de), but can be a regional suffix (kiev.ua). Name the
  // two labels, and do not claim to know the operator.
  return { domain: lastTwo, certain: !countryCode };
}

/**
 * True when the hostname spells out the address it belongs to — dashed,
 * dotted, reversed, zero-padded, or as hex. Digit boundaries stop
 * "11-1-1-15" from counting as 1.1.1.1.
 */
export function embedsIp(hostname: string, ip: string): boolean {
  const canonical = canonicalIp(ip);

  if (!canonical) {
    return false;
  }

  const host = hostname.toLowerCase();

  if (isIpv4(canonical)) {
    const octets = canonical.split(".");
    const padded = octets.map((octet) => octet.padStart(3, "0"));
    const reversed = [...octets].reverse();
    const hex = octets.map((octet) => Number(octet).toString(16).padStart(2, "0")).join("");

    const forms = [
      octets.join("-"), octets.join("."), octets.join("_"),
      reversed.join("-"), reversed.join("."), reversed.join("_"),
      padded.join("-"), padded.join("."), padded.join(""),
    ];

    if (forms.some((form) => new RegExp(`(?<![0-9])${escape(form)}(?![0-9])`).test(host))) {
      return true;
    }

    return new RegExp(`(?<![0-9a-f])${hex}(?![0-9a-f])`).test(host);
  }

  // IPv6 is written several ways in real PTRs. Googlebot uses the fully
  // padded form: crawl-2001-4860-4801-0010-0000-0000-0000-0005.googlebot.com
  const groups = ipv6Groups(canonical);

  if (!groups) {
    return false;
  }

  const padded = groups.map((group) => group.toString(16).padStart(4, "0"));
  const forms = [
    canonical.replace(/:/g, "-"), // compressed:  2001-db8-1--5
    groups.map((group) => group.toString(16)).join("-"), // expanded:  2001-db8-1-0-0-0-0-5
    padded.join("-"), // padded:    2001-0db8-0001-0000-0000-0000-0000-0005
    padded.join(""), // as one 32-digit hex string
  ];

  return forms.some((form) => new RegExp(`(?<![0-9a-f])${escape(form)}(?![0-9a-f])`).test(host));
}

const CONNECTION_PATTERNS: { pattern: RegExp; label: string; detail: string }[] = [
  { pattern: /(?:^|[.-])(?:dyn|dynamic|pool|dhcp|ppp|pppoe|dialup|dial|dip)(?=[.\d-]|$)/, label: "Dynamic address", detail: "Handed out from a pool, so the same IP may belong to someone else tomorrow." },
  { pattern: /(?:^|[.-])(?:static|fixed)(?=[.\d-]|$)/, label: "Static address", detail: "Assigned permanently to one customer." },
  { pattern: /(?:^|[.-])(?:cable|hsd\d*|docsis|cpe)(?=[.\d-]|$)/, label: "Cable broadband", detail: "A home or small-office cable line." },
  { pattern: /(?:^|[.-])(?:dsl|adsl|vdsl|xdsl)(?=[.\d-]|$)/, label: "DSL broadband", detail: "A home or small-office DSL line." },
  { pattern: /(?:^|[.-])(?:fiber|fibre|ftth|fttx|fttp|gpon)(?=[.\d-]|$)/, label: "Fibre broadband", detail: "A fibre-to-the-premises line." },
  { pattern: /(?:^|[.-])(?:mobile|lte|4g|5g|gprs|umts|cell|wwan|mobileinternet)(?=[.\d-]|$)/, label: "Mobile network", detail: "A phone or mobile-broadband connection, usually behind carrier NAT." },
];

const CLOUD_PATTERNS: { test: (host: string) => string | null; label: string }[] = [
  {
    label: "Amazon Web Services",
    test: (host) => {
      if (host.endsWith(".compute-1.amazonaws.com")) return "EC2 instance in us-east-1";
      const region = host.match(/\.([a-z]{2}-[a-z]+-\d)\.compute\.amazonaws\.com$/);
      if (region) return `EC2 instance in ${region[1]}`;
      return host.endsWith(".amazonaws.com") ? "An AWS-managed host" : null;
    },
  },
  {
    label: "Google Cloud",
    test: (host) =>
      host.endsWith(".bc.googleusercontent.com")
        ? "A Compute Engine address. Most belong to Google Cloud customers, though Google runs some crawlers from these ranges too, so the name alone does not identify a Google crawler"
        : host.endsWith(".gae.googleusercontent.com")
          ? "An App Engine address. Google uses these for fetches users trigger, including on behalf of Google Cloud customers. It is not Googlebot"
          : null,
  },
  {
    label: "Microsoft Azure",
    test: (host) => {
      const region = host.match(/\.([a-z0-9]+)\.cloudapp\.azure\.com$/);
      if (region) return `A cloud service in ${region[1]}`;
      return host.endsWith(".cloudapp.net") ? "A classic Azure cloud service" : null;
    },
  },
  { label: "Hetzner", test: (host) => (host.endsWith(".your-server.de") ? "A dedicated or cloud server" : null) },
  {
    label: "OVHcloud",
    test: (host) =>
      /\.ovh\.(net|ca|us)$/.test(host) || /\.ip-\d+-\d+-\d+\.(eu|net|us)$/.test(host) ? "A dedicated or VPS server" : null,
  },
  {
    label: "Akamai (Linode)",
    test: (host) =>
      host.endsWith(".linodeusercontent.com") || host.endsWith(".members.linode.com") ? "A Linode instance" : null,
  },
  { label: "Vultr", test: (host) => (host.endsWith(".vultrusercontent.com") ? "A Vultr instance" : null) },
];

export function readAnatomy(hostname: string, ip: string): Anatomy {
  const host = hostname.toLowerCase();
  const hints: Hint[] = [];
  const generated = embedsIp(host, ip);

  if (generated) {
    hints.push({
      kind: "generic",
      label: "Generated from the address",
      detail: "The name spells out the IP itself, so it identifies the network, not a particular machine.",
    });
  }

  for (const cloud of CLOUD_PATTERNS) {
    const detail = cloud.test(host);

    if (detail) {
      hints.push({ kind: "cloud", label: cloud.label, detail });
      break;
    }
  }

  // Strip the operator's domain first, so "hsd1.ca.comcast.net" is read but
  // a brand that happens to contain "cable" or "fiber" is not.
  const { domain, certain } = operatorDomain(host);
  const local = host.endsWith(`.${domain}`) ? host.slice(0, -(domain.length + 1)) : host;

  for (const connection of CONNECTION_PATTERNS) {
    if (connection.pattern.test(local)) {
      hints.push({ kind: "connection", label: connection.label, detail: connection.detail });
    }
  }

  const firstLabel = local.split(".")[0] ?? "";

  if (/^(?:mx|mail|smtp|mta|relay|outbound|mailout)\d*(?:-|$)/.test(firstLabel)) {
    hints.push({
      kind: "mail",
      label: "Named like a mail server",
      detail: "Receiving servers check that a sender's reverse DNS forward-confirms, so this record matters for deliverability.",
    });
  }

  return { domain, domainCertain: certain, embedsIp: generated, hints };
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
