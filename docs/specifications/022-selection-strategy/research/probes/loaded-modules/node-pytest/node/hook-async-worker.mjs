import { appendFileSync } from "node:fs";
let file = null;
export function initialize(data) { if (data?.out) file = `${data.out}/${data.pid}-async.ndjson`; }
const rec = (kind, parent, url) => { if (file && url.startsWith("file:")) appendFileSync(file, JSON.stringify({ kind, parent, url }) + "\n"); };
export async function resolve(specifier, context, next) { const r = await next(specifier, context); rec("aresolve", context.parentURL ?? null, r.url); return r; }
export async function load(url, context, next) { const r = await next(url, context); rec("aload", null, url); return r; }
