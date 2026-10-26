import { IdentityBadge, VerdictBadge } from "@/components/status";
import { bulkTally } from "@/lib/report";
import type { ReverseResult } from "@/lib/lookup";

export function BulkTable({
  results,
  rejected,
  ranges,
  duplicates,
  respelled,
  overflow,
}: {
  results: ReverseResult[];
  rejected: string[];
  ranges: string[];
  duplicates: number;
  respelled: number;
  overflow: number;
}) {
  const tally = bulkTally(results);
  const apiProblems = results.filter((result) => result.apiProblem);

  return (
    <section className="space-y-3">
      <p className="font-serif text-lg text-stone-900">
        <span className="highlight">{tally.line}</span>
      </p>

      {apiProblems.length > 0 ? (
        <p className="border border-sky-700/30 bg-sky-50 px-4 py-2.5 text-sm leading-6 text-sky-900">
          {apiProblems.length === results.length ? "" : `${apiProblems.length} of these: `}
          {apiProblems[0].apiProblem}
        </p>
      ) : null}

      {tally.liveOnly > 0 || tally.storedOnly > 0 ? (
        <ul className="space-y-1 text-xs leading-5 text-stone-600">
          {tally.liveOnly > 0 ? (
            <li>
              {tally.liveOnly} hostname{tally.liveOnly === 1 ? " comes" : "s come"} from live DNS, where
              ipgeolocation.io&apos;s stored record was out of date.
            </li>
          ) : null}
          {tally.storedOnly > 0 ? (
            <li>
              {tally.storedOnly} hostname{tally.storedOnly === 1 ? " is" : "s are"} ipgeolocation.io&apos;s
              stored record, because the live PTR query failed. They are marked{" "}
              <span className="font-medium">stored</span> below.
            </li>
          ) : null}
        </ul>
      ) : null}

      {rejected.length > 0 || ranges.length > 0 || duplicates > 0 || overflow > 0 ? (
        <ul className="space-y-1 text-xs leading-5 text-stone-600">
          {overflow > 0 ? (
            <li>
              {overflow} more address{overflow === 1 ? " was" : "es were"} left out. The limit is{" "}
              {results.length} per lookup. Run them as a second batch.
            </li>
          ) : null}
          {duplicates > 0 ? (
            <li>
              {duplicates} duplicate{duplicates === 1 ? " was" : "s were"} merged
              {respelled > 0
                ? `, ${respelled === duplicates ? "" : `${respelled} of them `}the same IPv6 address written differently`
                : ""}
              .
            </li>
          ) : null}
          {ranges.length > 0 ? (
            <li>
              Skipped as {ranges.length === 1 ? "a range" : "ranges"}, because reverse DNS is per address:{" "}
              <span className="break-all font-mono">{ranges.slice(0, 6).join(", ")}</span>
              {ranges.length > 6 ? ` and ${ranges.length - 6} more` : ""}.
            </li>
          ) : null}
          {rejected.length > 0 ? (
            <li>
              Skipped as not an IP address:{" "}
              <span className="break-all font-mono">{rejected.slice(0, 6).join(", ")}</span>
              {rejected.length > 6 ? ` and ${rejected.length - 6} more` : ""}.
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="overflow-x-auto border border-stone-300 bg-white">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-double border-stone-300 font-serif text-blue-900">
              <th scope="col" className="w-10 px-3 py-2.5 font-normal text-stone-500">#</th>
              <th scope="col" className="px-3 py-2.5 font-normal">Address</th>
              <th scope="col" className="px-3 py-2.5 font-normal">Hostname</th>
              <th scope="col" className="px-3 py-2.5 font-normal">Check</th>
              <th scope="col" className="px-3 py-2.5 font-normal">Network</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={result.ip} className="border-b border-stone-200 align-top last:border-b-0">
                <td className="px-3 py-2.5 font-mono text-xs text-stone-500">{index + 1}</td>
                <td className="px-3 py-2.5">
                  <a
                    href={`/?q=${encodeURIComponent(result.ip)}`}
                    className="break-all font-mono text-blue-800 underline decoration-blue-800/25 underline-offset-2 hover:decoration-blue-800"
                  >
                    {result.ip}
                  </a>
                </td>
                <td className="px-3 py-2.5">
                  {result.error ? (
                    <span className="text-xs text-amber-800">{result.error}</span>
                  ) : result.hostname ? (
                    <div className="space-y-1">
                      <p className="break-all font-mono text-stone-900">{result.hostname}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.identity ? <IdentityBadge identity={result.identity} /> : null}
                        {result.source === "ipgeolocation" ? (
                          <span
                            className="border border-stone-400/50 bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700"
                            title="ipgeolocation.io's stored record, used because the live PTR query failed"
                          >
                            stored
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <span className="font-serif italic text-stone-500">
                      {result.verdict === "inconclusive" ? "no answer" : "none"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{result.error ? null : <VerdictBadge verdict={result.verdict} />}</td>
                <td className="px-3 py-2.5 text-stone-600">
                  {result.network ? (
                    <>
                      <p className="max-w-[16rem] truncate">{result.network.organization || "unknown"}</p>
                      <p className="text-xs text-stone-500">
                        {[result.network.flag, result.network.country].filter(Boolean).join(" ")}
                      </p>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Select any address for its full round-trip report.</p>
    </section>
  );
}
