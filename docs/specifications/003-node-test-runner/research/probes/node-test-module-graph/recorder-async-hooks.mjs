// THROWAWAY probe. Hooks thread side of recorder-async.mjs.
let port;
export function initialize(data) { port = data.port; }
export async function resolve(specifier, context, nextResolve) {
  const r = await nextResolve(specifier, context);
  port.postMessage(["e", context.parentURL ?? null, specifier, r.url]);
  return r;
}
export async function load(url, context, nextLoad) { port.postMessage(["l", url]); return nextLoad(url, context); }
