// Throwaway probe: sync module hooks (module.registerHooks) that append every
// resolved file: URL (resolve) and every loaded URL (load) to
// $LM_OUT/<pid>-<threadId>.ndjson. Loaded with `--import <this file>`.
import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
import { threadId, isInternalThread } from "node:worker_threads";
const out = process.env.LM_OUT;
if (out && !isInternalThread && typeof registerHooks === "function") {
  const file = `${out}/${process.pid}-${threadId}.ndjson`;
  const seen = new Set();
  const rec = (kind, parent, url) => {
    const k = `${kind}\n${parent}\n${url}`;
    if (seen.has(k)) return;
    seen.add(k);
    appendFileSync(file, JSON.stringify({ kind, parent, url, argv1: process.argv[1] ?? null }) + "\n");
  };
  registerHooks({
    resolve(specifier, context, next) {
      const r = next(specifier, context);
      if (r.url.startsWith("file:")) rec("resolve", context.parentURL ?? null, r.url);
      return r;
    },
    load(url, context, next) {
      const r = next(url, context);
      if (url.startsWith("file:")) rec("load", null, url);
      return r;
    },
  });
}
