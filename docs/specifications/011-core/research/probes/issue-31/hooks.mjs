// Map the source tree's `.js` specifiers to `.ts`, and stub queue.ts's two leaf imports.
const STUBS = {
  "/core/fs/index.js":
    "export function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }",
  "/core/keys/index.js":
    "export function testFileId(ref) { return `${ref.project}\\0${ref.path}`; }",
};
export async function resolve(specifier, context, next) {
  if (context.parentURL?.includes("/core/scheduler/") && specifier.startsWith("..")) {
    const url = new URL(specifier, context.parentURL).href;
    for (const [suffix, source] of Object.entries(STUBS))
      if (url.endsWith(suffix))
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  }
  if (context.parentURL?.includes("/core/") && specifier.startsWith(".") && specifier.endsWith(".js"))
    return next(specifier.replace(/\.js$/, ".ts"), context);
  return next(specifier, context);
}
