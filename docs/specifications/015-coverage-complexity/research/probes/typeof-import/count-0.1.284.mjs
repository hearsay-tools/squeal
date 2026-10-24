// Throwaway probe (015-25). Parse errors and the functions in them, test-named files apart from the rest, with a
// given counter (the released 0.1.284 from `git archive squeal--v0.1.284 src`, or the worktree's).
// node_modules/.bin/tsx count-0.1.284.mjs <counter index.ts> <repo> <exclude regex|->
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
const [counter, root, extra] = process.argv.slice(2);
const { countFile } = await import(counter);
const ex = extra !== "-" ? new RegExp(extra) : null;
const before = (l, c, L, C) => l < L || (l === L && c < C);
const overlaps = (a, b) => b.startLine === b.endLine && b.startColumn === b.endColumn
  ? before(a.startLine, a.startColumn, b.startLine, b.startColumn) && !before(a.endLine, a.endColumn, b.startLine, b.startColumn)
  : before(a.startLine, a.startColumn, b.endLine, b.endColumn) && before(b.startLine, b.startColumn, a.endLine, a.endColumn);
const files = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).split("\n")
  .filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p))
  .filter((p) => !/(^|\/)(dist|build|vendor|node_modules)\//.test(p) && !p.endsWith(".min.js") && !(ex && ex.test(p)));
const res = { testNamed: { files: 0, errFiles: [], lost: 0 }, other: { files: 0, errFiles: [], lost: 0 } };
for (const p of files) {
  if (statSync(`${root}/${p}`).size > 524288) continue;
  const text = readFileSync(`${root}/${p}`, "utf8");
  const c = await countFile(text, /\.[cm]?jsx?$/.test(p) ? "javascript" : "typescript");
  const r = res[/\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(p) ? "testNamed" : "other"];
  r.files++;
  if (!c.errors.length) continue;
  const n = c.functions.filter((f) => c.errors.some((e) => overlaps(f.range, e))).length;
  r.errFiles.push(`${p}:${n}`); r.lost += n;
}
res.testNamed.errFiles = res.testNamed.errFiles.length;
console.log(JSON.stringify(res));
