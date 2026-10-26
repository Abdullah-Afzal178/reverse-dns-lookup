import { BulkTable } from "@/components/bulk-table";
import { HostnameReport } from "@/components/hostname-report";
import { PoweredByBadge } from "@/components/powered-by-badge";
import { QueryForm } from "@/components/query-form";
import { SingleReport } from "@/components/single-report";
import { parseQuery } from "@/lib/input";
import { PAGE_TITLE } from "@/lib/constants";
import { reverseHostname, reverseMany, reverseOne } from "@/lib/lookup";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Everything is awaited rather than streamed through <Suspense>: streaming
 * leaves the result in a hidden element until a client script reveals it, so
 * with JavaScript off a visitor would see only the loading state.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const params = await searchParams;
  // Never sliced: cutting mid-token turns "9.9.9.10" into "9.9.9.1". parseQuery
  // refuses absurd lengths outright instead.
  const query = Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-double border-blue-900/70 pb-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">
            DNS · PTR records · Forward confirmation
          </p>
          <h1 className="mt-2 font-serif text-3xl text-blue-900 sm:text-4xl">{PAGE_TITLE}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600 sm:text-base">
            The hostname behind an IP address, and whether that name can be trusted. A reverse
            record is only as good as the forward lookup that confirms it.
          </p>
        </div>
        <PoweredByBadge className="shrink-0" />
      </header>

      {/* One landmark holds the form, the result and the notes. */}
      <main>
        <div className="mt-6">
          <QueryForm query={query.trim()} />
        </div>

        <section aria-label="Result" className="mt-8">
          <Result query={query} />
        </section>

        <Notes />
      </main>
    </div>
  );
}

async function Result({ query }: { query: string }) {
  const parsed = parseQuery(query);

  switch (parsed.kind) {
    case "empty":
      return <Introduction />;
    case "invalid":
      return (
        <p className="border border-amber-700/30 bg-amber-50 px-5 py-4 text-sm text-amber-900">{parsed.reason}</p>
      );
    case "ip":
      return <SingleReport result={await reverseOne(parsed.ip)} />;
    case "ips":
      return (
        <BulkTable
          results={await reverseMany(parsed.ips)}
          rejected={parsed.rejected}
          ranges={parsed.ranges}
          duplicates={parsed.duplicates}
          respelled={parsed.respelled}
          overflow={parsed.overflow}
        />
      );
    case "hostname":
      return <HostnameReport report={await reverseHostname(parsed.hostname)} />;
  }
}

function Introduction() {
  const modes = [
    {
      title: "One address",
      body: "The full round trip: the PTR record, the forward lookup that confirms it, what the name gives away, and the network behind it.",
      example: "66.249.66.1",
    },
    {
      title: "A list",
      body: "Paste up to fifty addresses from a log or a blocklist and get every hostname and confirmation in one table.",
      example: "8.8.8.8, 1.1.1.1, 9.9.9.9",
    },
    {
      title: "A hostname",
      body: "Check it from the other end: each address it resolves to, and whether that address points back. The test a mail server runs on you.",
      example: "gmail-smtp-in.l.google.com",
    },
  ];

  return (
    <ol className="grid gap-px border border-stone-300 bg-stone-300 sm:grid-cols-3">
      {modes.map((mode, index) => (
        <li key={mode.title} className="bg-white px-5 py-5">
          <p className="font-serif text-sm text-stone-400" aria-hidden="true">{["i.", "ii.", "iii."][index]}</p>
          <h2 className="mt-1 font-serif text-xl text-blue-900">{mode.title}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">{mode.body}</p>
          <a
            href={`/?q=${encodeURIComponent(mode.example)}`}
            className="mt-3 inline-block font-mono text-xs text-blue-800 underline decoration-blue-800/30 underline-offset-2 hover:decoration-blue-800"
          >
            {mode.example}
          </a>
        </li>
      ))}
    </ol>
  );
}

function Notes() {
  const notes = [
    {
      title: "What a PTR record is",
      body: "Ordinary DNS turns a name into an address. Reverse DNS goes the other way, through a PTR record in the reverse zone for the address block. That zone is run by whoever holds the block, usually the ISP or hosting provider, not the person using the address.",
    },
    {
      title: "Why the forward check matters",
      body: "Whoever controls an address's reverse zone can make its PTR say anything, crawl-1.googlebot.com included. What they cannot do is make googlebot.com's own DNS point back at that address. So a reverse name is only trustworthy once it resolves back to the same address: forward-confirmed reverse DNS.",
    },
    {
      title: "Verifying crawlers",
      body: "Google, Microsoft, Apple and other operators document this check for their crawlers, because a User-Agent string is trivially faked. It has to match the crawler's own documented hostnames, not just the operator's domain. Gmail's mail servers confirm under google.com, but they are not Googlebot. The rules also differ by operator: Google publishes some fetcher names with no forward record, which only its published IP lists can confirm. This tool does not check those lists, so it reports such names as unverified rather than fake.",
    },
    {
      title: "Mail servers",
      body: "Many receiving mail servers check that a sending address has a PTR record, and the large providers expect it to forward-confirm. Gmail, for one, rejects mail from addresses that fail this. When mail starts bouncing or landing in spam, it is one of the first things to rule out, alongside SPF, DKIM and DMARC.",
    },
  ];

  return (
    <section aria-labelledby="notes-heading" className="mt-14 border-t-4 border-double border-blue-900/70 pt-8">
      <h2 id="notes-heading" className="font-serif text-2xl text-blue-900">
        Notes
      </h2>
      <div className="mt-5 grid gap-x-10 gap-y-6 md:grid-cols-2">
        {notes.map((note) => (
          <div key={note.title}>
            <h3 className="font-serif text-lg text-stone-900">{note.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-stone-600">{note.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
