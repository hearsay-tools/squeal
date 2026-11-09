// Throwaway probe for research/quality-gate.md, Q5. Not product code.
//
// Builds small fixture repositories under <scratch>/cases and runs #167's
// collection cases one-shot against Squeal's primitives: the Vitest and
// node:test adapters with coverage, `mapHere`, `countFile`, `joinCoverage`,
// `crapScore`. No daemon, no store.
//
// Usage: node_modules/.bin/tsx cases.mts <squeal src root> <scratch> <node_modules dir> <out.json>

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const [squeal, scratch, modules, out] = process.argv.slice(2) as [string, string, string, string];
const src = (p: string) => join(squeal, "src", p);
const { createVitestAdapter } = await import(src("runners/vitest/index.ts"));
const { createNodeTestAdapter } = await import(src("runners/node-test/adapter.ts"));
const { coverageProvider } = await import(src("core/code/coverage/runtime.ts"));
const { mapHere } = await import(src("core/code/coverage/mapper.ts"));
const { decodeRecord } = await import(src("core/code/coverage/record.ts"));
const { countFile } = await import(src("core/code/count/index.ts"));
const { joinCoverage } = await import(src("core/code/crap/join.ts"));
const { crapScore } = await import(src("core/code/crap/score.ts"));
const { blobHash } = await import(src("core/hash/blob.ts"));
const provider = coverageProvider(new URL(`file://${src("core/code/coverage/runtime.ts")}`));

type Files = Record<string, string>;
function fixture(name: string, files: Files): string {
  const root = join(scratch, "cases", name);
  rmSync(root, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  symlinkSync(modules, join(root, "node_modules"));
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "fixture"], { cwd: root });
  return root;
}

type Covered = { testFile: { path: string }; payload: string; sources: Map<string, unknown>; ownRoot?: string };
interface Measure {
  vitest?: string[];
  node?: { project: Record<string, unknown>; files: string[] };
  timeoutMs?: number;
  /** Before mapping: what to do to a payload (the truncation case). */
  tamper?: (file: Covered) => void;
}
async function measure(root: string, m: Measure) {
  const temp = mkdtempSync(join(scratch, "tmp-"));
  const covered: Covered[] = [];
  const collected = (run: { files: Covered[] }) => covered.push(...run.files);
  const reports: Record<string, unknown> = {};
  const records: { test: string; record?: { sources: { path: string; blob: string }[]; unread: string[] }; error?: string }[] = [];
  // Maps what was collected so far, before the adapter's close removes its payload directory.
  const mapAll = () => {
    for (const file of covered.splice(0)) {
      m.tamper?.(file);
      try {
        records.push({ test: file.testFile.path, record: decodeRecord(mapHere(file as never, "sha1", new Map(), () => false)) });
      } catch (error) {
        records.push({ test: file.testFile.path, error: String(error).slice(0, 160) });
      }
    }
  };
  const t = performance.now();
  if (m.vitest !== undefined) {
    const a = await createVitestAdapter({ root, coverage: { enabled: () => true, provider, tempDir: temp, collected } });
    await a.testFiles();
    const logDir = mkdtempSync(join(temp, "v-"));
    const r = await a.run(m.vitest.map((path) => ({ project: "", path })), { runId: "v", logDir, timeoutMs: m.timeoutMs ?? 600_000, workers: 2 });
    reports.vitest = { end: r.end, completed: r.completedFiles.map((f: { path: string }) => f.path), failure: r.failure, fails: r.results.filter((x: { outcome: string }) => x.outcome === "fail").map((x: { check: unknown }) => x.check) };
    mapAll();
    await a.close();
  }
  if (m.node !== undefined) {
    const notes: string[] = [];
    const a = await createNodeTestAdapter(m.node.project, { root, tempDir: temp, note: (n: string) => notes.push(n), coverage: { enabled: () => true, collected } });
    await a.environment();
    await a.testFiles();
    const logDir = mkdtempSync(join(temp, "n-"));
    const name = m.node.project.name as string;
    const r = await a.run(m.node.files.map((path) => ({ project: name, path })), { runId: "n", logDir, timeoutMs: m.timeoutMs ?? 600_000 });
    reports.node = { end: r.end, completed: r.completedFiles.map((f: { path: string }) => f.path), failure: r.failure, notes, fails: r.results.filter((x: { outcome: string }) => x.outcome === "fail").length };
    mapAll();
    await a.close();
  }
  const runMs = Math.round(performance.now() - t);
  rmSync(temp, { recursive: true, force: true });
  return { reports, runMs, records };
}

async function functionsOf(root: string, path: string, records: Awaited<ReturnType<typeof measure>>["records"]) {
  const bytes = readFileSync(join(root, path));
  const blob = blobHash(bytes, "sha1");
  const count = await countFile(bytes.toString("utf8"), "typescript", blob);
  const sources = records.flatMap((r) => r.record?.sources.filter((s) => s.path === path && s.blob === blob) ?? []);
  const joined = joinCoverage(count.functions, sources as never);
  return count.functions.map((f: { qualifiedName: string; complexity: number; range: { startLine: number } }, i: number) => ({
    fn: `${f.qualifiedName}:${f.range.startLine}`,
    cc: f.complexity,
    ran: joined[i].ran,
    cov: Math.round(joined[i].coverage * 100) / 100,
    crap: Math.round(crapScore(f.complexity, joined[i].coverage) * 100) / 100,
    records: sources.length,
  }));
}

const pkg = JSON.stringify({ name: "fixture", private: true, type: "module" });
const results: Record<string, unknown> = {};

// 1. Arrow shapes and vi.mock factories (Vitest).
{
  const root = fixture("arrows", {
    "package.json": pkg,
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    "src/dep.ts": `export const dep = (): number => 1;\n`,
    "src/shapes.ts": [
      `import { dep } from "./dep";`,
      `export interface Box { field: number }`,
      `export const pick = (x: unknown) => (x as Box).field;`,
      `export const chain = (a: number) => (xs: number[]) => xs.map((v) => v * a).filter((v) => v > 2).join(",");`,
      `export const three = (a: number) =>`,
      `  (b: number) =>`,
      `    (c: number) => a + b + c;`,
      `export const viaDep = () => dep() + 1;`,
      `export const never = (x: number) => (x > 0 ? x : -x);`,
      ``,
    ].join("\n"),
    "test/shapes.test.ts": [
      `import { describe, expect, it, vi } from "vitest";`,
      `import { hostname } from "node:os";`,
      `import { chain, pick, three, viaDep } from "../src/shapes";`,
      `vi.mock("../src/dep", () => ({ dep: () => 41 }));`,
      `vi.mock("node:os", async (importOriginal) => {`,
      `  const real = await importOriginal<typeof import("node:os")>();`,
      `  return { ...real, hostname: () => "h" };`,
      `});`,
      `describe("shapes", () => {`,
      `  it("pick", () => expect(pick({ field: 3 })).toBe(3));`,
      `  it("chain", () => expect(chain(2)([1, 2, 3])).toBe("4,6"));`,
      `  it("three", () => expect(three(1)(2)(3)).toBe(6));`,
      `  it("mock", () => expect(viaDep()).toBe(42));`,
      `  it("os", () => expect(hostname()).toBe("h"));`,
      `});`,
      ``,
    ].join("\n"),
  });
  const r = await measure(root, { vitest: ["test/shapes.test.ts"] });
  const counted = await countFile(readFileSync(join(root, "src/shapes.ts"), "utf8"), "typescript");
  const v8 = r.records.flatMap((x) => x.record?.sources.filter((s) => s.path === "src/shapes.ts") ?? []) as unknown as { functions: unknown[] }[];
  results.arrows = {
    ...r,
    src: await functionsOf(root, "src/shapes.ts", r.records),
    test: await functionsOf(root, "test/shapes.test.ts", r.records),
    // Why a join is null: the counter's ranges beside the record's V8 functions (line, column, end line, end column, hit).
    counterRanges: counted.functions.map((f: { qualifiedName: string; range: unknown }) => [f.qualifiedName, f.range]),
    v8Functions: v8[0]?.functions,
  };
}

// 2-4, 7. node:test .ts natively and through --import tsx; mixed with Vitest on one source.
{
  const shared = [
    `export function fromVitest(x: number): number {`,
    `  if (x > 1) return x;`,
    `  return -x;`,
    `}`,
    `export function fromNode(x: number): number {`,
    `  if (x > 1) return x * 2;`,
    `  return 0;`,
    `}`,
    `export const untouched = (x: number) => (x ? 1 : 2);`,
    ``,
  ].join("\n");
  const nodeTest = (from: string) =>
    [`import { test } from "node:test";`, `import assert from "node:assert/strict";`, `import { fromNode } from "${from}";`, `test("node", () => { assert.equal(fromNode(3), 6); });`, ``].join("\n");
  const root = fixture("mixed", {
    "package.json": pkg,
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.vt.test.ts"] } });\n`,
    "src/shared.ts": shared,
    "test/shared.vt.test.ts": `import { expect, it } from "vitest";\nimport { fromVitest } from "../src/shared";\nit("v", () => expect(fromVitest(3)).toBe(3));\n`,
    "node/native.test.ts": nodeTest("../src/shared.ts"),
    "node/tsx.test.ts": nodeTest("../src/shared"),
  });
  const native = await measure(root, { node: { project: { name: "native", argv: [], env: {}, include: ["node/native.test.ts"] }, files: ["node/native.test.ts"] } });
  results.nodeNative = { ...native, src: await functionsOf(root, "src/shared.ts", native.records) };
  const tsx = await measure(root, { node: { project: { name: "tsx", argv: ["--import", "tsx"], env: {}, include: ["node/tsx.test.ts"] }, files: ["node/tsx.test.ts"] } });
  results.nodeTsx = { ...tsx, src: await functionsOf(root, "src/shared.ts", tsx.records), test: await functionsOf(root, "node/tsx.test.ts", tsx.records) };
  const mixed = await measure(root, {
    vitest: ["test/shared.vt.test.ts"],
    node: { project: { name: "tsx", argv: ["--import", "tsx"], env: {}, include: ["node/tsx.test.ts"] }, files: ["node/tsx.test.ts"] },
  });
  results.mixed = { ...mixed, src: await functionsOf(root, "src/shared.ts", mixed.records) };
  // 5. A truncated V8 file: the node:test payload cut in half before it is mapped.
  const cut = await measure(root, {
    vitest: ["test/shared.vt.test.ts"],
    node: { project: { name: "tsx", argv: ["--import", "tsx"], env: {}, include: ["node/tsx.test.ts"] }, files: ["node/tsx.test.ts"] },
    tamper: (file) => {
      if (file.ownRoot !== undefined) truncateSync(file.payload, Math.floor(statSync(file.payload).size / 2));
    },
  });
  results.truncated = { ...cut, src: await functionsOf(root, "src/shared.ts", cut.records) };
}

// 4, 6. A deadline with a fast and a slow file; the project's own larger testTimeout.
{
  const root = fixture("deadline", {
    "package.json": pkg,
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 } });\n`,
    "src/a.ts": `export const fast = (x: number) => (x > 0 ? 1 : 0);\nexport const slow = (x: number) => (x > 0 ? 2 : 0);\n`,
    "test/fast.test.ts": `import { expect, it } from "vitest";\nimport { fast } from "../src/a";\nit("fast", () => expect(fast(1)).toBe(1));\n`,
    "test/slow.test.ts": `import { expect, it } from "vitest";\nimport { slow } from "../src/a";\nit("slow", async () => { await new Promise((r) => setTimeout(r, 7_000)); expect(slow(1)).toBe(2); });\n`,
  });
  const whole = await measure(root, { vitest: ["test/fast.test.ts", "test/slow.test.ts"] });
  results.testTimeoutFloor = { ...whole, src: await functionsOf(root, "src/a.ts", whole.records) };
  const cut = await measure(root, { vitest: ["test/fast.test.ts", "test/slow.test.ts"], timeoutMs: 3_000 });
  results.deadline = { ...cut, src: await functionsOf(root, "src/a.ts", cut.records) };
}

// 8. Import-graph selection, and a changed source no test maps to.
{
  const root = join(scratch, "cases", "mixed");
  writeFileSync(join(root, "src/orphan.ts"), `export function orphan(x: number) {\n  if (x) return 1;\n  if (x > 2) return 2;\n  return 3;\n}\n`);
  const a = await createVitestAdapter({ root });
  await a.testFiles();
  const affectedShared = await a.affected(["src/shared.ts"]);
  const affectedOrphan = await a.affected(["src/orphan.ts"]);
  await a.close();
  results.selection = { affectedShared, affectedOrphan, orphan: await functionsOf(root, "src/orphan.ts", []) };
}

writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write("done\n");
