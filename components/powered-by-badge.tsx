import { POWERED_BY_URL } from "@/lib/constants";

export function PoweredByBadge({ className }: { className?: string }) {
  return (
    <a
      href={POWERED_BY_URL}
      target="_blank"
      rel="noreferrer"
      className={[
        "inline-flex items-center gap-2 border border-blue-900/20 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 transition hover:border-blue-900/50",
        className ?? "",
      ].join(" ")}
    >
      <span className="inline-block h-1.5 w-1.5 bg-yellow-400" aria-hidden="true" />
      Powered by ipgeolocation.io
    </a>
  );
}
