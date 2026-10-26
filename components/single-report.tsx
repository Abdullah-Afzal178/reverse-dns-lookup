import { RoundTrip } from "@/components/round-trip";
import { IdentityBadge, VERDICT_COPY, VerdictBadge, identitySentence, verdictSentence } from "@/components/status";
import type { ReverseResult } from "@/lib/lookup";
import { sourceNote } from "@/lib/report";
import { sameIp } from "@/lib/ip";

export function SingleReport({ result }: { result: ReverseResult }) {
  if (result.error) {
    return (
      <section className="border border-amber-700/30 bg-amber-50 px-5 py-4">
        <p className="font-serif text-lg text-amber-900">No answer for {result.ip}</p>
        <p className="mt-1 text-sm leading-6 text-amber-900/90">{result.error}</p>
      </section>
    );
  }

  const { ip, hostname, forward, verdict, identity, anatomy, network, storedHostname, alternatives } = result;
  const copy = VERDICT_COPY[verdict];

  return (
    <article className="space-y-6">
      {result.apiProblem ? (
        <p className="border border-sky-700/30 bg-sky-50 px-4 py-2.5 text-sm leading-6 text-sky-900">{result.apiProblem}</p>
      ) : null}

      <RoundTrip result={result} />

      <div className="border-l-4 border-blue-900 bg-white px-5 py-4">
        <p className={`text-xs font-semibold uppercase tracking-[0.12em] ${copy.tone}`}>{copy.short}</p>
        <p className="mt-1.5 font-serif text-lg leading-8 text-stone-900 [overflow-wrap:anywhere]">
          <span className="highlight">{verdictSentence(verdict, ip, hostname, result.apiProblem === null)}</span>
        </p>
        {identity ? (
          <div className="mt-3 flex flex-wrap items-start gap-2 text-sm leading-6 text-stone-700">
            <IdentityBadge identity={identity} />
            <span className="min-w-0 flex-1">{identitySentence(identity, verdict, result.source)}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet title="The records">
          <dl className="divide-y divide-stone-200 text-sm">
            <Row term="PTR for this address">
              {hostname ? (
                <span className="font-mono">{hostname}</span>
              ) : verdict === "inconclusive" ? (
                <Muted>no answer from DNS</Muted>
              ) : (
                <Muted>none published</Muted>
              )}
            </Row>
            {storedHostname ? (
              <Row term="ipgeolocation.io's record">
                <span className="font-mono text-stone-600">{storedHostname}</span>
                <span className="ml-2 text-xs text-stone-600">
                  {hostname ? "no longer what DNS publishes" : "no longer published"}
                </span>
              </Row>
            ) : null}
            <Row term="That name resolves to">
              {!hostname ? (
                <Muted>nothing to resolve</Muted>
              ) : forward?.status === "failed" ? (
                <span className="text-amber-800">{forward.reason}</span>
              ) : forward && forward.addresses.length > 0 ? (
                <ul className="space-y-0.5">
                  {forward.addresses.map((address) => {
                    const match = sameIp(address, ip);

                    return (
                      <li key={address} className="font-mono">
                        <span className={match ? "highlight" : ""}>{address}</span>
                        {match ? <span className="ml-2 font-sans text-xs text-emerald-800">this address</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Muted>no public addresses</Muted>
              )}
              {forward?.status === "resolved" && forward.failedFamilies.length > 0 ? (
                <p className="mt-1 text-xs text-sky-800">
                  The {forward.failedFamilies.map((f) => (f === "v4" ? "IPv4 (A)" : "IPv6 (AAAA)")).join(" and ")}{" "}
                  lookup did not answer, so this list may be incomplete.
                </p>
              ) : null}
              {forward?.status === "resolved" && forward.hidden ? (
                <p className="mt-1 text-xs text-stone-600">
                  Plus {forward.hidden} private or internal address{forward.hidden === 1 ? "" : "es"}, not shown.
                </p>
              ) : null}
            </Row>
            {result.omittedNames > 0 ? (
              <Row term="Not checked">
                <span className="text-sm text-stone-700">
                  {result.omittedNames} more PTR name{result.omittedNames === 1 ? "" : "s"} this address publishes
                  {verdict === "inconclusive" && hostname
                    ? "; none of the names checked points back, so one of these might"
                    : ""}
                  .
                </span>
              </Row>
            ) : null}
            {alternatives.length > 0 ? (
              <Row term="Other PTR names">
                <ul className="space-y-1">
                  {alternatives.map((alt) => (
                    <li key={alt.name} className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono">{alt.name}</span>
                      <VerdictBadge verdict={alt.verdict} />
                    </li>
                  ))}
                </ul>
              </Row>
            ) : null}
          </dl>
          <p className="mt-3 text-xs leading-5 text-stone-600 [overflow-wrap:anywhere]">
            {sourceNote(result)}
          </p>
        </Sheet>

        <Sheet title="Reading the name">
          {anatomy ? (
            <>
              <dl className="divide-y divide-stone-200 text-sm">
                <Row term={verdict === "confirmed" && anatomy.domainCertain ? "Operator's domain" : "Domain in the name"}>
                  <span className="font-mono">{anatomy.domain}</span>
                </Row>
              </dl>
              {anatomy.hints.length > 0 ? (
                <ul className="mt-3 space-y-2.5">
                  {anatomy.hints.map((hint) => (
                    <li key={hint.label} className="text-sm">
                      <span className="font-medium text-stone-900">{hint.label}.</span>{" "}
                      <span className="text-stone-600">{hint.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-stone-600">
                  No naming pattern recognised. It may be a hand-picked name, or a convention this
                  tool does not know.
                </p>
              )}
              <p className="mt-3 text-xs leading-5 text-stone-500">
                Read from naming conventions, which operators are free to ignore. Treat these as
                hints, not facts.
              </p>
            </>
          ) : (
            <p className="text-sm text-stone-600">There is no name to read.</p>
          )}
        </Sheet>
      </div>

      {network ? (
        <Sheet title="The network behind it">
          <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
            <Row term="Organisation">{network.organization || <Muted>unknown</Muted>}</Row>
            <Row term="AS number">
              {network.asNumber ? <span className="font-mono">{network.asNumber}</span> : <Muted>unknown</Muted>}
            </Row>
            <Row term="Network type">{titleCase(network.asnType) || <Muted>unknown</Muted>}</Row>
            <Row term="Location">
              {[network.flag, [network.city, network.region, network.country].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" ") || <Muted>unknown</Muted>}
            </Row>
          </dl>
        </Sheet>
      ) : null}
    </article>
  );
}

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-stone-300 bg-white px-5 py-4">
      <h2 className="border-b-2 border-double border-stone-300 pb-2 font-serif text-lg text-blue-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-stone-500 sm:w-44">{term}</dt>
      <dd className="min-w-0 break-words text-stone-900">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="font-serif italic text-stone-500">{children}</span>;
}

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : "";
}
