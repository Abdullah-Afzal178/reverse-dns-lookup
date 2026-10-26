export const SITE_NAME = "Reverse DNS Lookup";

export const PAGE_TITLE = "Reverse DNS Lookup & PTR Check";

export const PAGE_DESCRIPTION =
  "Find the hostname behind any IP address, then prove it: forward-confirmed reverse DNS, verified Googlebot and Bingbot checks, bulk lookups, and mail-server PTR checks.";

export const POWERED_BY_URL = "https://ipgeolocation.io";

export const EXAMPLES = [
  { query: "8.8.8.8", label: "8.8.8.8" },
  { query: "66.249.66.1", label: "A Googlebot address" },
  { query: "2606:4700:4700::1111", label: "IPv6" },
  { query: "8.8.8.8\n1.1.1.1\n9.9.9.9\n208.80.154.224\n73.162.0.1", label: "A list of five" },
  { query: "gmail-smtp-in.l.google.com", label: "A mail server" },
];
