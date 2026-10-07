// Throwaway probe (001-102): preload with --import; logs every installed module Node resolves, per process,
// and every bare specifier that failed to resolve. Covers ESM import, require(), require.resolve and child
// processes that inherit NODE_OPTIONS. Line: pid ppid testfile|- ok|absent parentURL specifier url
import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
const out = process.env.PPK_TRACE;
const seen = new Set();
const file = () => globalThis.__vitest_worker__?.filepath ?? "-";
const log = (status, context, specifier, url) => {
  const line = `${process.pid} ${process.ppid} ${file()} ${status} ${context.parentURL ?? "-"} ${specifier} ${url}`;
  if (out && !seen.has(line)) { seen.add(line); appendFileSync(out, `${line}\n`); }
};
registerHooks({
  resolve(specifier, context, next) {
    let r;
    try {
      r = next(specifier, context);
    } catch (error) {
      if (!/^[./]|^node:|^file:/.test(specifier)) log("absent", context, specifier, "-");
      throw error;
    }
    if (r.url.includes("/node_modules/")) log("ok", context, specifier, r.url);
    return r;
  },
});
