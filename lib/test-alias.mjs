// Lets the unit tests run under plain node by teaching it the "@/" path alias
// that tsconfig gives the Next.js build.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(`${import.meta.dirname}/../`).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root).href;

      return nextResolve(target.endsWith(".ts") ? target : `${target}.ts`, context);
    }

    return nextResolve(specifier, context);
  },
});
