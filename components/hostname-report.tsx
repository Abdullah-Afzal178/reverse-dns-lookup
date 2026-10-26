import { ArrowRight } from "lucide-react";

import { IdentityBadge, VerdictBadge } from "@/components/status";
import type { HostnameReport as Report } from "@/lib/lookup";
import { hostnameSummary } from "@/lib/report";

/**
 * The check from the hostname's end: each address it resolves to, the PTR of
 * that address, and whether the PTR resolves back. Point it at a server that
 * sends mail, and this is the check a receiving mail server runs against it.
 */
export function HostnameReport({ report }: { report: Report }) {
  const { hostname, forward, results } = report;
  const { header, summary, caveats } = hostnameSummary(report);
  const apiProblem = results.find((result) => result.apiProblem)?.apiProblem;

  if (forward.status === "failed") {
    return (
      <section className="border border-amber-700/30 bg-amber-50 px-5 py-4">
        <p className="font-serif text-lg text-amber-900 [overflow-wrap:anywhere]">{header}</p>
        <p className="mt-1 text-sm leading-6 text-amber-900/90">{summary}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {apiProblem ? (
        <p className="border border-sky-700/30 bg-sky-50 px-4 py-2.5 text-sm leading-6 text-sky-900">{apiProblem}</p>
      ) : null}

      <div className="border-l-4 border-blue-900 bg-white px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-600 [overflow-wrap:anywhere]">
          {header}
        </p>
        <p className="mt-1.5 font-serif text-lg leading-8 text-stone-900 [overflow-wrap:anywhere]">
          <span className="highlight">{summary}</span>
        </p>
        {caveats.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm leading-6 text-stone-700 [overflow-wrap:anywhere]">
            {caveats.map((caveat) => (
              <li key={caveat} className="flex gap-2">
                <span aria-hidden="true" className="text-stone-500">
                  •
                </span>
                <span>{caveat}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ol className="space-y-3">
        {results.map((result) => (
          <li key={result.ip} className="border border-stone-300 bg-white px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-sm">
              <a
                href={`/?q=${encodeURIComponent(result.ip)}`}
                className="break-all text-blue-800 underline decoration-blue-800/25 underline-offset-2 hover:decoration-blue-800"
              >
                {result.ip}
              </a>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-label="PTR" />
              {result.error ? (
                <span className="font-sans text-xs text-amber-800">{result.error}</span>
              ) : result.hostname ? (
                <span className="break-all text-stone-900">{result.hostname}</span>
              ) : (
                <span className="font-serif italic text-stone-500">
                  {result.verdict === "inconclusive" ? "no answer from DNS" : "no PTR record"}
                </span>
              )}
            </div>
            {result.error ? null : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <VerdictBadge verdict={result.verdict} />
                {result.identity ? <IdentityBadge identity={result.identity} /> : null}
                {result.hostname === hostname ? (
                  <span className="text-xs text-stone-600">the PTR matches the name you entered</span>
                ) : null}
                {result.source === "live" && result.storedHostname ? (
                  <span className="text-xs text-stone-600">from live DNS, because ipgeolocation.io&apos;s record was out of date</span>
                ) : null}
                {result.source === "ipgeolocation" ? (
                  <span className="text-xs text-stone-600">ipgeolocation.io&apos;s stored record, used because the live PTR query failed</span>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
