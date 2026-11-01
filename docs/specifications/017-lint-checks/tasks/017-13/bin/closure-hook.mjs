// 017-13 probe: log every file URL an ESM import resolves to (module.register hook).
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (r.url.startsWith("file:") && !r.url.includes("/node_modules/")) process.stdout.write(`${r.url}\n`);
  return r;
}
