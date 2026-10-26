import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";

import { VERDICT_COPY, VerdictIcon } from "@/components/status";
import type { ReverseResult } from "@/lib/lookup";

/**
 * Reverse DNS drawn as the round trip it really is: the address names a host,
 * and the host has to name the address back. Laid out left to right on wide
 * screens and top to bottom on narrow ones.
 */
export function RoundTrip({ result }: { result: ReverseResult }) {
  const { ip, hostname, verdict, network } = result;
  const copy = VERDICT_COPY[verdict];
  const forwardRan = hostname !== null;

  return (
    <figure
      className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)]"
      aria-label={
        hostname
          ? `${ip} reverse resolves to ${hostname}; forward check: ${copy.short}`
          : verdict === "inconclusive"
            ? `${ip}: the reverse lookup got no answer`
            : `${ip} has no PTR record`
      }
    >
      <Node label="Address" value={ip} footnote={network?.organization || undefined} />

      <div className="flex flex-col justify-center gap-3 py-1 text-xs">
        <div className="flex items-center justify-center gap-2 text-blue-900">
          <span className="font-mono">PTR</span>
          <ArrowRight className="hidden h-4 w-4 md:block" aria-hidden="true" />
          <ArrowDown className="h-4 w-4 md:hidden" aria-hidden="true" />
          <span className="font-serif italic text-stone-500">reverse</span>
        </div>
        <div className={`flex items-center justify-center gap-2 ${forwardRan ? copy.tone : "text-stone-500"}`}>
          <span className="font-serif italic text-stone-500">forward</span>
          <ArrowLeft className="hidden h-4 w-4 md:block" aria-hidden="true" />
          <ArrowUp className="h-4 w-4 md:hidden" aria-hidden="true" />
          <span className="font-mono">A/AAAA</span>
          {forwardRan ? <VerdictIcon verdict={verdict} className="h-4 w-4" /> : null}
        </div>
      </div>

      <Node
        label="Hostname"
        value={hostname}
        empty={verdict === "inconclusive" ? "No answer" : "No PTR record"}
        footnote={operatorFootnote(result)}
      />
    </figure>
  );
}

/**
 * Only a forward-confirmed name proves who runs it. An unconfirmed one names
 * a domain — which is exactly what a forged PTR would do — so it says so.
 */
function operatorFootnote(result: ReverseResult): string | undefined {
  const domain = result.anatomy?.domain;

  if (!domain || domain === result.hostname) {
    return undefined;
  }

  if (result.verdict !== "confirmed") {
    return `a name under ${domain}, not confirmed`;
  }

  return result.anatomy?.domainCertain ? `run by ${domain}` : `a name under ${domain}`;
}

function Node({
  label,
  value,
  empty,
  footnote,
}: {
  label: string;
  value: string | null;
  empty?: string;
  footnote?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center border border-stone-300 bg-white px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">{label}</p>
      {value ? (
        <p className="mt-1 break-all font-mono text-base text-stone-900 sm:text-lg">{value}</p>
      ) : (
        <p className="mt-1 font-serif text-base italic text-stone-500 sm:text-lg">{empty}</p>
      )}
      {footnote ? <p className="mt-1 truncate text-xs text-stone-500">{footnote}</p> : null}
    </div>
  );
}
