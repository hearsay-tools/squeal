// Throwaway (026, daemonless-hooks). A PostToolBatch stand-in with no daemon:
// one fresh Node process that counts complexity and/or runs oxlint on the named
// files through Squeal's own modules, and writes counts to code.sqlite.
// Bundled by build.mjs; run by drive.sh. Prints one JSON line of phase times,
// each in ms since this process started (performance.now()).
// Usage: node inline.mjs <root> <commonDir> <mode: count|oxlint|both|sqlite|none> <rel paths...>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countFile } from "../../../../../../src/core/code/count/index.js";
import { openCodeStore, isCodeStoreOpenFailure } from "../../../../../../src/core/code/store/open.js";
import { oxlintProvider } from "../../../../../../src/core/lint/provider/oxlint/provider.js";

const marks: Record<string, number> = { start: performance.now() };
const mark = (name: string) => (marks[name] = Math.round(performance.now() * 10) / 10);
const [root, commonDir, mode, ...paths] = process.argv.slice(2);
const texts = paths.map((p) => ({ path: p, text: readFileSync(join(root!, p), "utf8") }));
mark("read");
let functions = 0;
let findings = 0;
let lintNote: string | null = null;
const counts: Awaited<ReturnType<typeof countFile>>[] = [];
if (mode === "count" || mode === "both" || mode === "sqlite") {
  for (const f of texts) {
    const c = await countFile(f.text, "typescript");
    counts.push(c);
    functions += c.functions.length;
    if (counts.length === 1) mark("count1"); // includes the WASM load
  }
  mark("counted");
}
if (mode === "sqlite" || mode === "both") {
  const store = openCodeStore(commonDir as never, { complexity: { enabled: true } } as never);
  if (isCodeStoreOpenFailure(store)) throw new Error(`code store: ${store.reason}`);
  mark("sqliteOpen");
  const wt = "probe-wt" as never;
  store.transaction(() => {
    store.states.list(wt); // the previous states a transition compares with
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i]!;
      store.counts.put(c, Date.now() as never);
      store.files.upsertMany(wt, [
        { path: paths[i], blob: c.blob, language: "typescript", counterVersion: c.counterVersion, size: texts[i]!.text.length, revision: 1 } as never,
      ]);
    }
  });
  store.close();
  mark("sqliteWritten");
}
if (mode === "oxlint" || mode === "both") {
  const p = oxlintProvider({ root: root as never });
  const opened = await p.open("sha1");
  mark("oxlintOpen");
  if ("off" in opened) lintNote = `off: ${opened.off}`;
  else {
    await p.inputs(paths as never); // `--debug files`: which named files oxlint lints
    mark("oxlintInputs");
    const report = await p.lint(texts as never);
    mark("oxlintLinted");
    if ("off" in report) lintNote = `off: ${report.off}`;
    else for (const r of report.results.values()) if ("findings" in r) findings += (r as { findings: unknown[] }).findings.length;
  }
  await p.close();
}
mark("end");
const mem = process.memoryUsage();
console.log(JSON.stringify({ mode, files: paths.length, functions, findings, lintNote, marks, rssMB: Math.round(mem.rss / 1048576) }));
