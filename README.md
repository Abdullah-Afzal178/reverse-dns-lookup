# Reverse DNS Lookup & PTR Check

The hostname behind an IP address — and whether that name can be trusted. Look up one address, a pasted list, or a hostname from the other end, and every answer is forward-confirmed against live DNS. Powered by [ipgeolocation.io](https://ipgeolocation.io).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js-000?logo=nextdotjs)](https://nextjs.org/)
[![Powered by ipgeolocation.io](https://img.shields.io/badge/Powered%20by-ipgeolocation.io-1e3a8a)](https://ipgeolocation.io)

<!-- Add a screenshot of the tool running locally at ./public/tool.png and reference it here -->

---

## What It Does

| Input | Example | What you get |
|---|---|---|
| **One address** | `66.249.66.1` | The full round trip: the PTR record, the forward lookup that confirms it, what the name gives away, and the network behind it |
| **A list** | up to 50 addresses, one per line | Every hostname and confirmation in one table — paste straight from a log or a blocklist |
| **A hostname** | `mx1.example.com` | Each address the name resolves to, the PTR of that address, and whether it points back |

### The verdicts

| Verdict | Meaning |
|---|---|
| **Forward-confirmed** | The PTR name resolves back to the same address. The record is trustworthy. |
| **Does not point back** | The name resolves, but not to this address. Common behind a CDN or proxy, or with load-balanced names — and also exactly what a forged name looks like. |
| **Name does not resolve** | DNS says the name does not exist or has no addresses — usually a stale record. |
| **Could not check** | The DNS lookup itself failed or ran out of time. This says nothing about the record; try again. |
| **No hostname** | No PTR record is published. Normal for most clients — but a server that sends mail needs one. |

A failed lookup is never reported as a fact about the record: only an explicit "no such name" or "no records" answer from DNS counts against it, and every query that times out is retried once.

---

## Why the forward check is the whole point

Whoever controls an address's reverse zone can make its PTR record say anything — `crawl-66-249-66-1.googlebot.com` included. What they cannot do is make `googlebot.com`'s own DNS point back at that address. So a reverse answer only counts once the name resolves back to the same IP: **forward-confirmed reverse DNS**.

That single check powers two practical jobs:

- **Verifying crawlers.** Google, Microsoft, Apple and others tell site owners to verify their bots exactly this way, because a User-Agent string is trivially faked. The tool only says **"Verified Googlebot"** when the name matches the hostnames Google documents *for its crawlers* and forward-confirms. Any other confirmed name in a Google domain — Gmail's outbound mail servers, for instance — is a **"Verified Google host"**: proven to be Google's, not proven to be a crawler. "Fake" is reserved for a documented crawler hostname that fails the check.
- **Mail deliverability.** Many receiving mail servers check that a sending address has a PTR record, and the large providers expect it to forward-confirm — Gmail, for one, rejects mail from addresses that fail this. It is one of the first things to rule out when mail starts bouncing, alongside SPF, DKIM and DMARC.

---

## Why ipgeolocation.io

- **[IP Geolocation API](https://ipgeolocation.io/documentation/ip-location-api.html)** with `include=hostname,network` — the stored PTR hostname, the ASN and organisation, and the location, in **one call**.
- **[Bulk endpoint](https://ipgeolocation.io/documentation/ip-location-api.html)** — a whole pasted list in one request, with the same includes. Usually back within a second or two; occasionally, for addresses it has not seen before, much longer — one cold batch of 50 took 32 seconds. So the tool never waits on it to start DNS work, and if it is slow the result comes from live DNS alone, with a note.
- **Free tier** — both work on the free plan, and results are cached for 30 minutes.

### Stored record and live DNS, together

The API's stored hostname is fast and reliable, but a stored record can outlive the real one — `74.6.143.26` is stored as `unknown.yahoo.com`, while live DNS publishes `media-router-fp74.prod.media.vip.bf1.yahoo.com`, which forward-confirms. So for every address the tool runs a live PTR query **in parallel** with the stored name's forward check:

- **Live DNS answers** → its name is the PTR. When it matches the stored record the page says the two agree; when it differs, the stored name is shown alongside for reference.
- **Live DNS times out** → the stored name stands in, and the page says so. This is where the API earns its keep: live PTR queries fail often, and the stored record still has the answer.
- **Live DNS says there is no PTR** → there is none, whatever was stored.

The API's own `hostnameFallbackLive` mode does a live fallback too, but it runs those lookups one after another: measured on 42 addresses it had never seen, a bulk call took **42 seconds**, against **0.4** with `hostname`. Doing the live half here, in parallel and under a deadline, keeps a 50-address list to a few seconds.

> ipgeolocation.io also offers [ASN](https://ipgeolocation.io/documentation/asn-api.html), [Security](https://ipgeolocation.io/documentation/ip-security-api.html) (VPN, proxy, Tor detection), [Timezone](https://ipgeolocation.io/documentation/timezone-api.html), [User-Agent](https://ipgeolocation.io/documentation/user-agent-api.html), [Astronomy](https://ipgeolocation.io/documentation/astronomy-api.html), and [Abuse Contact](https://ipgeolocation.io/documentation/ip-abuse-contact-api.html) APIs.

**[Get your free API key →](https://ipgeolocation.io/signup)**

---

## Features

- **Forward-confirmed reverse DNS** on every answer, from a live query made at request time
- **Live PTR as the source of truth**, with ipgeolocation.io's stored record as the fallback — and both shown when they disagree
- **Crawler verification** for Googlebot, Google's special-case crawlers and user-triggered fetchers, Bingbot, Applebot, YandexBot, Baiduspider, Yahoo Slurp and Amazonbot — each under the name its operator documents, and kept separate from "this is a Google host". App Engine addresses are deliberately never verified: Google says they can fetch on behalf of Google Cloud customers
- **A hard 12-second budget** per request: slow nameservers are reported as "could not check", never left hanging
- **Honest failures** — PTR records are queried directly, so a timeout or server failure is never mistaken for "no record"
- **Every PTR name** — an address can publish several; each is checked and ranked, and the others are listed with their own verdicts
- **Never leaks internal DNS** — private, loopback and internal addresses in any answer are counted, never shown
- **Degrades instead of failing** — if ipgeolocation.io is slow, down or refuses the key, the result comes from live DNS alone, and the page says so
- **Bulk lookups** of up to 50 addresses in one API call, with duplicates merged across IPv6 spellings
- **Hostname round trip** — check a server from the name end
- **Reading the name** — spots names generated from the address, connection types, and cloud providers with their regions
- **Works with JavaScript off** — every result is rendered on the server
- **Shareable URLs** — every lookup is a link
- **SEO-ready** — Open Graph tags, meta description, `robots.txt`, `sitemap.xml`, and favicon

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org/) (App Router) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) |
| Language | TypeScript |
| Icons | [lucide-react](https://lucide.dev/) |
| Reverse DNS | [ipgeolocation.io](https://ipgeolocation.io) |
| Forward check | Node's `dns` resolver |

---

## Getting Started

### Prerequisites

- Node.js 18+
- An [ipgeolocation.io](https://ipgeolocation.io/signup) API key (free tier is enough)

### Run It Locally

1. Clone the repo:

```bash
git clone https://github.com/Abdullah-Afzal178/reverse-dns-lookup.git
cd reverse-dns-lookup
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root:

```env
IPGEOLOCATION_API_KEY=your_api_key_here
```

4. Start the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000).

---

## Tests

The IP handling, input parsing, verdicts, crawler checks, summaries and hostname reading are pure functions with no dependencies, covered by 431 assertions — including end-to-end runs of the lookup code against scripted DNS timeouts, SERVFAILs, refusals and a failing API:

```bash
npm test
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `IPGEOLOCATION_API_KEY` | Yes | Your [ipgeolocation.io](https://ipgeolocation.io/signup) API key |
| `DNS_RETRY_SERVERS` | No | Resolvers a timed-out DNS query is retried against. Default `1.1.1.1,8.8.8.8`; set it empty to retry through the system resolver only |
| `NEXT_PUBLIC_SITE_URL` | No | Your production URL if you deploy (used for sitemap and OG metadata) |

---

## How It Works

1. The query is classified as one address, a list, or a hostname. IPs inside URLs or with a port are accepted, internationalised names are converted to punycode, and IPv6 is normalised to its RFC 5952 form so every spelling of the same address compares equal.
2. Private, reserved and documentation addresses are answered locally — they have no public reverse DNS, so no API call is spent on them.
3. One API call (or one bulk call for a list) returns each address's stored hostname and network. When there is no hostname, the API echoes the address back; that is recognised as "none".
4. At the same moment, every address's live PTR query starts — it does not need the API. The API is given a timeout that keeps time back for DNS; if it is slow, down, or refuses the key, the result comes from live DNS alone and the page says so. Live DNS wins whenever it answers.
5. The chosen name is forward-resolved for both IPv4 and IPv6. Only an explicit "no such name" or "no records" answer counts as a fact about the record.
6. Every query goes to the system resolver first. A timeout or server failure is retried once through a public resolver — measured on cold lists, most of what a local resolver gave up on under load answered there at once, while genuinely broken zones still fail.
7. Every address in a list is looked up at once, and the whole request races a 12-second budget. The verdict, the identity check and the name hints are computed and rendered on the server.

A cold list of 50 addresses typically completes in about seven seconds. The handful marked "could not check" are, in measurement, almost all reverse zones that fail at public resolvers too.

## Project Structure

```
reverse-dns-lookup/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                # Classifies the query and renders the right report
│   ├── opengraph-image.tsx
│   ├── robots.ts
│   └── sitemap.ts
├── components/
│   ├── round-trip.tsx          # The PTR / forward diagram
│   ├── single-report.tsx
│   ├── bulk-table.tsx
│   ├── hostname-report.tsx
│   ├── status.tsx              # Verdict badges and wording
│   ├── query-form.tsx
│   └── powered-by-badge.tsx
├── lib/
│   ├── ip.ts                   # Validation and canonical form (pure)
│   ├── input.ts                # Query classification (pure)
│   ├── verify.ts               # Verdicts and crawler checks (pure)
│   ├── anatomy.ts              # Reading the hostname (pure)
│   ├── pool.ts                 # Bounded concurrency (pure)
│   ├── lookup.ts               # API calls, live PTR and forward DNS (server only)
│   ├── lookup.test.ts          # End-to-end, with DNS and the API scripted
│   ├── report.ts               # List tally, hostname summary, source note (pure)
│   └── session-cache.ts
├── .env                        # API key (not committed)
└── README.md
```

---

## Want to Deploy It?

Works out of the box on any platform that supports Next.js:

- **Vercel** — import the repo, add `IPGEOLOCATION_API_KEY`, deploy.
- **Netlify**, **Cloudflare Pages**, **Railway** — similar process. The forward check needs outbound DNS, which these platforms allow.
- **Self-hosted** — `npm run build && npm start`.

---

## License

MIT — see [LICENSE](LICENSE) for details.
