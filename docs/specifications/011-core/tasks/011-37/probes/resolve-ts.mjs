// Throwaway probe (011-35, copied for 011-37): maps a relative `.js` import to the `.ts` file beside it,
// so Node 24's own type stripping runs Squeal's sources with no install and no build.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && specifier.endsWith(".js") && context.parentURL) {
    const ts = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
  }
  return next(specifier, context);
}
