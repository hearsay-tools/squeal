// Throwaway probe for research/quality-gate.md, Q4 and Q5. Not product code.
//
// Child-process coverage in a one-shot run, with Squeal's own node:test
// mapper (`ownRecord`) applied to each child's `NODE_V8_COVERAGE` file. A
// Vitest test spawns a tsx child and a plain .mjs child that run src/work.ts
// and src/plain.mjs; the variable reaches the children through the
// project's `test.env`, as cezar's collector sets it. One child file is then
// truncated, to show a per-file skip. A test also prints whether it sees the
// variable (the visibility question).
//
// Usage: node_modules/.bin/tsx child.mts <squeal src root> <scratch> <node_modules dir> <out.json>

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [squeal, scratch, modules, out] = process.argv.slice(2) as [string, string, string, string];
const src = (p: string) => join(squeal, "src", p);
const { ownRecord } = await import(src("core/code/coverage/own.ts"));
const { countFile } = await import(src("core/code/count/index.ts"));
const { joinCoverage } = await import(src("core/code/crap/join.ts"));
const { crapScore } = await import(src("core/code/crap/score.ts"));
const { blobHash } = await import(src("core/hash/blob.ts"));

const root = join(scratch, "cases", "child");
const v8 = join(scratch, "cases", "child-v8");
rmSync(root, { recursive: true, force: true });
rmSync(v8, { recursive: true, force: true });
mkdirSync(v8, { recursive: true });
const files: Record<string, string> = {
  "package.json": JSON.stringify({ name: "child", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], env: { NODE_V8_COVERAGE: ${JSON.stringify(v8)} } } });\n`,
  "src/work.ts": `export function work(x: number): number {\n  if (x > 10) return x * 2;\n  if (x > 5) return x + 1;\n  return 0;\n}\nexport const unused = (x: number) => (x ? 1 : 0);\n`,
  "src/plain.mjs": `export function plain(x) {\n  return x > 1 ? "big" : "small";\n}\n`,
  "bin/run-ts.ts": `import { work } from "../src/work.ts";\nprocess.stdout.write(String(work(Number(process.argv[2]))));\n`,
  "bin/run-plain.mjs": `import { plain } from "../src/plain.mjs";\nprocess.stdout.write(plain(Number(process.argv[2])));\n`,
  "test/child.test.ts": [
    `import { execFileSync } from "node:child_process";`,
    `import { writeFileSync } from "node:fs";`,
    `import { expect, it } from "vitest";`,
    `it("tsx child", () => {`,
    `  expect(execFileSync(process.execPath, ["--import", "tsx", "bin/run-ts.ts", "12"], { encoding: "utf8" })).toBe("24");`,
    `});`,
    `it("plain child with an explicit env", () => {`,
    `  const out = execFileSync(process.execPath, ["bin/run-plain.mjs", "3"], { encoding: "utf8", env: { PATH: process.env.PATH } });`,
    `  expect(out).toBe("big");`,
    `});`,
    `it("sees the variable", () => {`,
    `  writeFileSync("visible.json", JSON.stringify(process.env.NODE_V8_COVERAGE ?? null));`,
    `});`,
    ``,
  ].join("\n"),
};
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
symlinkSync(modules, join(root, "node_modules"));
const run = execFileSync(join(root, "node_modules/.bin/vitest"), ["run"], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1" } });
const visible = readFileSync(join(root, "visible.json"), "utf8");

const payloads = readdirSync(v8).filter((f) => f.endsWith(".json")).sort();
// Truncate one payload that names a worktree script (CUT_INDEX, default the last), to show a per-file skip.
const named = payloads.filter((f) => readFileSync(join(v8, f), "utf8").includes(`file://${root}/`));
const cut = named.length > 1 ? named[Number(process.env.CUT_INDEX ?? named.length - 1)] ?? null : null;
if (cut !== null) truncateSync(join(v8, cut), Math.floor(statSync(join(v8, cut)).size / 2));

const records: unknown[] = [];
const skipped: { file: string; error: string }[] = [];
for (const file of payloads) {
  try {
    const payload = JSON.parse(readFileSync(join(v8, file), "utf8"));
    const record = ownRecord(root, payload, "sha1");
    if (record.sources.length > 0 || record.unread.length > 0) records.push(record);
  } catch (error) {
    skipped.push({ file, error: String(error).slice(0, 120) });
  }
}
const measure = async (path: string) => {
  const bytes = readFileSync(join(root, path));
  const blob = blobHash(bytes, "sha1");
  const count = await countFile(bytes.toString("utf8"), "typescript", blob);
  const sources = (records as { sources: { path: string; blob: string }[] }[]).flatMap((r) => r.sources.filter((s) => s.path === path && s.blob === blob));
  const joined = joinCoverage(count.functions, sources as never);
  return count.functions.map((f: { qualifiedName: string; complexity: number }, i: number) => ({
    fn: f.qualifiedName,
    cc: f.complexity,
    ran: joined[i].ran,
    cov: Math.round(joined[i].coverage * 100) / 100,
    crap: Math.round(crapScore(f.complexity, joined[i].coverage) * 100) / 100,
    childRecords: sources.length,
  }));
};
const result = {
  testsPassed: /Tests\s+3 passed/.test(run),
  visibleInTest: visible,
  payloads: payloads.length,
  payloadsNamingWorktree: named.length,
  truncated: cut,
  skipped,
  records: (records as { sources: { path: string }[]; unread: string[] }[]).map((r) => ({ sources: r.sources.map((s) => s.path), unread: r.unread })),
  work: await measure("src/work.ts"),
  plain: await measure("src/plain.mjs"),
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
