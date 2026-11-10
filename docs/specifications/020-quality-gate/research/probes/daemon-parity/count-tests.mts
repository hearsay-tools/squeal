// Throwaway probe (survey 020-07, Q3). Counts every test file one worktree
// lists, with Squeal's own counter (`countFile`, COUNTER_VERSION 3), as the
// daemon would if test files were counted. Read-only: reads the store with
// node:sqlite { readOnly: true } and the files from disk; writes nothing.
// Usage (from the worktree root):
//   node_modules/.bin/tsx <this file> <common-dir> <worktree-id>
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { countFile } from "../../../../../../src/core/code/count/index.ts";
import { CODE_EXTENSIONS } from "../../../../../../src/core/types/code.ts";

const [commonDir, worktreeId] = process.argv.slice(2);
const main = new DatabaseSync(`${commonDir}/squeal/store.sqlite`, { readOnly: true });
const paths = [
  ...new Set(
    main
      .prepare("select path from test_file_keys where worktree_id = ?")
      .all(worktreeId)
      .map((r) => String((r as { path: string }).path)),
  ),
].sort();

const MAX = 524_288;
const out = {
  load1Before: readFileSync("/proc/loadavg", "utf8").split(" ")[0],
  testFiles: paths.length,
  counted: 0,
  tooBig: 0,
  missing: 0,
  unsupported: 0,
  withErrors: 0,
  functions: 0,
  over20: [] as { path: string; name: string; cc: number }[],
  ccHistogram: {} as Record<string, number>,
  bytes: 0,
  cpuMs: 0,
  wallMs: 0,
  load1After: "",
};
await countFile("const warm = () => 1;", "typescript"); // the grammar's start, once per daemon
const cpu0 = process.cpuUsage();
const t0 = performance.now();
for (const path of paths) {
  const language = CODE_EXTENSIONS[extname(path)];
  if (language === undefined) {
    out.unsupported++;
    continue;
  }
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    out.missing++;
    continue;
  }
  if (size > MAX) {
    out.tooBig++;
    continue;
  }
  const text = readFileSync(path, "utf8");
  out.bytes += size;
  const count = await countFile(text, language);
  out.counted++;
  if (count.errors.length > 0) out.withErrors++;
  for (const fn of count.functions) {
    out.functions++;
    const bucket = fn.complexity <= 5 ? "1-5" : fn.complexity <= 10 ? "6-10" : fn.complexity <= 20 ? "11-20" : ">20";
    out.ccHistogram[bucket] = (out.ccHistogram[bucket] ?? 0) + 1;
    if (fn.complexity > 20) out.over20.push({ path, name: fn.qualifiedName, cc: fn.complexity });
  }
}
const cpu = process.cpuUsage(cpu0);
out.cpuMs = Math.round((cpu.user + cpu.system) / 1000);
out.wallMs = Math.round(performance.now() - t0);
out.load1After = readFileSync("/proc/loadavg", "utf8").split(" ")[0];
console.log(JSON.stringify(out, null, 2));
