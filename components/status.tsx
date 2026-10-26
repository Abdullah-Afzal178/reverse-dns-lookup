import { Check, CircleDashed, CircleHelp, RotateCcw, X } from "lucide-react";

import type { IdentityCheck, Verdict } from "@/lib/verify";

export const VERDICT_COPY: Record<Verdict, { short: string; tone: string; badge: string }> = {
  confirmed: {
    short: "Forward-confirmed",
    tone: "text-emerald-800",
    badge: "border-emerald-700/30 bg-emerald-50 text-emerald-800",
  },
  mismatch: {
    short: "Does not point back",
    tone: "text-rose-800",
    badge: "border-rose-700/30 bg-rose-50 text-rose-800",
  },
  unresolvable: {
    short: "Name does not resolve",
    tone: "text-amber-800",
    badge: "border-amber-700/30 bg-amber-50 text-amber-800",
  },
  inconclusive: {
    short: "Could not check",
    tone: "text-sky-800",
    badge: "border-sky-700/30 bg-sky-50 text-sky-800",
  },
  none: {
    short: "No hostname",
    tone: "text-stone-600",
    badge: "border-stone-400/50 bg-stone-100 text-stone-700",
  },
};

export function VerdictIcon({ verdict, className }: { verdict: Verdict; className?: string }) {
  const Icon =
    verdict === "confirmed"
      ? Check
      : verdict === "mismatch"
        ? X
        : verdict === "unresolvable"
          ? CircleHelp
          : verdict === "inconclusive"
            ? RotateCcw
            : CircleDashed;

  return <Icon className={className} aria-hidden="true" />;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const copy = VERDICT_COPY[verdict];

  return (
    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-xs font-medium ${copy.badge}`}>
      <VerdictIcon verdict={verdict} className="h-3 w-3" />
      {copy.short}
    </span>
  );
}

/** "Verified Googlebot", "Fake Googlebot", "Verified Google host"… */
export function identityLabel(identity: NonNullable<IdentityCheck>): string {
  if (identity.kind === "crawler") {
    const word = identity.status === "verified" ? "Verified" : identity.status === "fake" ? "Fake" : "Unverified";

    return `${word} ${identity.crawler.name}`;
  }

  return `${identity.status === "verified" ? "Verified" : "Unverified"} ${identity.operator.name} host`;
}

export function IdentityBadge({ identity }: { identity: NonNullable<IdentityCheck> }) {
  const style =
    identity.status === "verified"
      ? "border-emerald-700/30 bg-emerald-50 text-emerald-800"
      : identity.status === "fake"
        ? "border-rose-700/30 bg-rose-50 text-rose-800"
        : "border-stone-400/50 bg-stone-100 text-stone-700";

  return (
    <span className={`inline-flex items-center border px-1.5 py-0.5 text-xs font-medium ${style}`}>
      {identityLabel(identity)}
    </span>
  );
}

/** What the identity result means, in a sentence. */
export function identitySentence(
  identity: NonNullable<IdentityCheck>,
  verdict: Verdict,
  source: "agree" | "live" | "ipgeolocation" | null = "live",
): string {
  if (identity.kind === "crawler") {
    const { name, operator } = identity.crawler;

    if (identity.status === "verified") {
      return `This is a genuine ${name}: the name matches the hostnames ${operator} documents for it, and it forward-confirms.`;
    }

    if (identity.status === "fake") {
      return `The name looks like a ${name} hostname, but it fails ${operator}'s own verification: ${operator}'s DNS does not resolve it back to this address. Treat it as an ordinary client, not as a ${name}.`;
    }

    // A live name the operator publishes without a forward record (Google's
    // user-triggered fetchers): DNS cannot settle it either way.
    if (verdict === "unresolvable" && source !== "ipgeolocation" && identity.crawler.forwardOptional) {
      return `The name is a ${name} hostname, but ${operator} publishes some of these without a forward record and verifies them against its published IP list instead, so DNS cannot confirm this one. Check the address against ${operator}'s list.`;
    }

    // Unverified with a definite failure can only be the stored record (the
    // live PTR query did not answer): the check ran, so say what it found.
    if (verdict === "mismatch" || verdict === "unresolvable") {
      return `The stored name looks like a ${name} hostname but does not resolve back to this address. The live PTR query did not answer, so whether the address publishes another name now is unknown, so it is not verified.`;
    }

    return `The name looks like a ${name} hostname, but the forward check could not be completed, so it is not verified either way.`;
  }

  const { name } = identity.operator;

  if (identity.status === "verified") {
    return `The name is in a domain ${name} controls and it forward-confirms, which proves the address is ${name}'s. It does not make it a crawler.`;
  }

  return verdict === "inconclusive"
    ? `The name is in a ${name} domain, but the forward check could not be completed, so ${name}'s ownership is not proven either way.`
    : `The name is in a ${name} domain but does not forward-confirm, so ${name}'s ownership is not proven.`;
}

/** One plain sentence that says what the verdict means for this address. */
export function verdictSentence(verdict: Verdict, ip: string, hostname: string | null, apiConsulted = true): string {
  switch (verdict) {
    case "confirmed":
      return `${hostname} resolves back to ${ip}, so the reverse record is trustworthy.`;
    case "mismatch":
      return `${hostname} does not resolve back to ${ip}, so the record cannot be confirmed. That is common for names behind a CDN or proxy, load-balanced service names, or a forgotten address record. It is also exactly what a forged name looks like.`;
    case "unresolvable":
      return `${hostname} has no address in DNS right now, so it cannot be confirmed. That usually means the reverse record is stale.`;
    case "inconclusive":
      return hostname
        ? `The forward lookup for ${hostname} failed this time, so it could not be checked. That says nothing about the record itself, so try again.`
        : apiConsulted
          ? `The reverse lookup for ${ip} did not answer, and ipgeolocation.io has no name on record, so whether a PTR exists is unknown. Try again.`
          : `The reverse lookup for ${ip} did not answer, and ipgeolocation.io could not be consulted either, so whether a PTR exists is unknown. Try again.`;
    case "none":
      return `${ip} has no reverse DNS record. That is normal for home connections and most clients, but a server that sends mail needs one, or major providers will reject its mail.`;
  }
}
