import { EXAMPLES } from "@/lib/constants";
import { MAX_BULK } from "@/lib/input";

/**
 * A plain GET form, so every result is a shareable URL and the page works
 * with JavaScript switched off. A textarea, because a list of addresses is a
 * first-class input here, not an afterthought.
 */
export function QueryForm({ query }: { query: string }) {
  return (
    <form
      action="/"
      method="get"
      role="search"
      aria-label="Reverse DNS lookup"
      className="border border-stone-300 bg-white transition focus-within:border-blue-900"
    >
      <label htmlFor="q" className="block border-b border-stone-200 px-4 py-2.5 text-xs text-stone-600">
        An IP address, a hostname, or a list of up to {MAX_BULK} addresses, one per line
      </label>
      <textarea
        id="q"
        name="q"
        rows={query.includes("\n") ? Math.min(8, query.split("\n").length + 1) : 2}
        defaultValue={query}
        placeholder={"8.8.8.8\nmail.example.com"}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="block w-full resize-y bg-transparent px-4 py-3 font-mono text-sm text-stone-900 outline-hidden placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-800"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="font-serif italic text-stone-600">e.g.</span>
          {EXAMPLES.map((example) => (
            <a
              key={example.label}
              href={`/?q=${encodeURIComponent(example.query)}`}
              className="text-blue-800 underline decoration-blue-800/30 underline-offset-2 transition hover:decoration-blue-800"
            >
              {example.label}
            </a>
          ))}
        </div>
        <button
          type="submit"
          className="bg-blue-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-950 focus:outline-none focus:ring-4 focus:ring-yellow-300"
        >
          Look up
        </button>
      </div>
    </form>
  );
}
