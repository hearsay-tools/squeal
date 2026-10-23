// Throwaway probe for 011-127. Patches a scratch clone's builders to log each call.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const clone = process.argv[2];
if (!clone?.startsWith("/tmp/")) throw new Error("usage: patch-builders.mjs /tmp/<clone>");
const LOG = `
function __r127(kind, detail) {
  try {
    const f = globalThis.__vitest_worker__?.filepath ?? process.env.R127_TEST ?? null;
    require("node:fs").appendFileSync(process.env.R127_LOG ?? "/tmp/r127/builders.jsonl",
      JSON.stringify({ kind, test: f, pid: process.pid, cwd: process.cwd(), detail }) + "\\n");
  } catch {}
}
`;
const esb = join(clone, "node_modules/esbuild/lib/main.js");
let src = readFileSync(esb, "utf8");
if (!src.includes("__r127")) {
  const entries = (o) => JSON.stringify({ entryPoints: o?.entryPoints, stdin: o?.stdin ? "stdin" : undefined, outfile: o?.outfile, outdir: o?.outdir, metafile: o?.metafile });
  src = src
    .replace("var build = (options) => ensureServiceIsRunning().build(options);",
      "var build = (options) => (__r127(\"esbuild.build\", __r127e(options)), ensureServiceIsRunning().build(options));")
    .replace("var context = (buildOptions) => ensureServiceIsRunning().context(buildOptions);",
      "var context = (buildOptions) => (__r127(\"esbuild.context\", __r127e(buildOptions)), ensureServiceIsRunning().context(buildOptions));")
    .replace("var buildSync = (options) => {", "var buildSync = (options) => {\n  __r127(\"esbuild.buildSync\", __r127e(options));");
  src += LOG + `function __r127e(o) { try { return (${entries.toString()})(o); } catch { return null; } }\n`;
  writeFileSync(esb, src);
}
const tsc = join(clone, "node_modules/typescript/lib/tsc.js");
let t = readFileSync(tsc, "utf8");
if (!t.includes("__r127")) {
  t = t.replace('import { execFileSync } from "node:child_process";',
    `import { execFileSync } from "node:child_process";\nimport { appendFileSync as __a } from "node:fs";\ntry { __a(process.env.R127_LOG ?? "/tmp/r127/builders.jsonl", JSON.stringify({ kind: "tsc", test: process.env.R127_TEST ?? null, pid: process.pid, cwd: process.cwd(), detail: process.argv.slice(2) }) + "\\n"); } catch {}`);
  writeFileSync(tsc, t);
}
console.log("patched", esb, tsc);
