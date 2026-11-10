// Throwaway probe for research/child-coverage.md. Not product code.
//
// Maps every child V8 file that run.sh left with Squeal's own `ownRecord`
// (row 015-86), per test file, then joins the union of each test file's
// child records to Squeal's counter with `joinCoverage` and scores CRAP.
// Also: the CPU of parse + ownRecord per child file, a truncated copy of
// one child file, and the late file of the detached child.
//
// Usage: node_modules/.bin/tsx analyze.mts <squeal worktree> <scratch> <out.json>

import { cpSync, existsSync, readdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [squeal, scratch, out] = process.argv.slice(2) as [string, string, string];
const src = (p: string) => join(squeal, "src", p);
const { ownRecord } = await import(src("core/code/coverage/own.ts"));
const { countFile } = await import(src("core/code/count/index.ts"));
const { joinCoverage } = await import(src("core/code/crap/join.ts"));
const { crapScore } = await import(src("core/code/crap/score.ts"));
const { blobHash } = await import(src("core/hash/blob.ts"));

const root = join(scratch, "fx");
type Rec = { sources: { path: string; blob: string }[]; unread: string[] };

function mapChild(file: string) {
  const bytes = statSync(file).size;
  const before = process.cpuUsage();
  const t0 = performance.now();
  try {
    const payload = JSON.parse(readFileSync(file, "utf8"));
    const record: Rec = ownRecord(root, payload, "sha1");
    const cpu = process.cpuUsage(before);
    return {
      file: file.split("/").pop(),
      bytes,
      scripts: payload.result.length,
      cpuMs: Math.round((cpu.user + cpu.system) / 100) / 10,
      wallMs: Math.round((performance.now() - t0) * 10) / 10,
      sources: record.sources.map((s) => s.path),
      unread: record.unread,
      record,
    };
  } catch (error) {
    return { file: file.split("/").pop(), bytes, error: String(error).slice(0, 140), record: null };
  }
}

async function measure(path: string, records: Rec[]) {
  const text = readFileSync(join(root, path));
  const blob = blobHash(text, "sha1");
  const count = await countFile(text.toString("utf8"), "typescript", blob);
  const sources = records.flatMap((r) => r.sources.filter((s) => s.path === path && s.blob === blob));
  const joined = joinCoverage(count.functions, sources as never);
  return count.functions.map((f: { qualifiedName: string; complexity: number }, i: number) => ({
    fn: f.qualifiedName,
    cc: f.complexity,
    ran: joined[i].ran,
    coverage: Math.round(joined[i].coverage * 100) / 100,
    crap: Math.round(crapScore(f.complexity, joined[i].coverage) * 100) / 100,
    childRecords: sources.length,
  }));
}

const SOURCES = ["src/work.ts", "src/plain.mjs", "src/lib.ts", "src/killed.mjs", "src/late.mjs"];
const result: Record<string, unknown> = {};
const allMaps: { bytes: number; cpuMs?: number }[] = [];

for (const pool of ["forks", "threads"]) {
  const dir = join(scratch, `out-${pool}`);
  const batches = readFileSync(join(dir, "batches.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const perFile: Record<string, unknown> = {};
  for (const batch of batches) {
    const testFile = relative(root, batch.testFile);
    const children = readdirSync(batch.children).sort().map((name) => mapChild(join(batch.children, name)));
    allMaps.push(...children.filter((c) => !("error" in c)) as never);
    const records = children.flatMap((c) => (c.record ? [c.record] : []));
    const measured: Record<string, unknown> = {};
    for (const path of SOURCES) measured[path] = await measure(path, records);
    perFile[testFile] = {
      workerPid: batch.pid,
      children: children.map(({ record, ...rest }) => rest),
      measured,
    };
  }
  // Union over both test files, as the evaluator joins every loader's record.
  const union = (Object.values(perFile) as { children: unknown[] }[]).length;
  result[pool] = { testFiles: union, perFile };
}

// node:test: the own file stays in Squeal's directory; children under children/.
{
  const cov = join(scratch, "out-node/cov");
  const own = readdirSync(cov).filter((n) => n.startsWith("coverage-"));
  const ownPid = readdirSync(cov).find((n) => n.startsWith("own-"))?.slice(4);
  const children = readdirSync(join(cov, "children")).sort().map((n) => mapChild(join(cov, "children", n)));
  const ownMapped = own.map((n) => mapChild(join(cov, n)));
  const records = children.flatMap((c) => (c.record ? [c.record] : []));
  const measured: Record<string, unknown> = {};
  for (const path of SOURCES) measured[path] = await measure(path, records);
  result.nodeTest = {
    ownPid,
    ownFiles: ownMapped.map(({ record, ...rest }) => rest),
    children: children.map(({ record, ...rest }) => rest),
    measured,
  };
}

// A truncated child file: a copy cut in half fails alone.
{
  const dir = join(scratch, "out-forks/children");
  const batch = readdirSync(dir).map((d) => join(dir, d)).find((d) => readdirSync(d).length > 1)!;
  const name = readdirSync(batch).find((n) => n.endsWith("-0.json"))!;
  const copy = join(scratch, "truncated.json");
  cpSync(join(batch, name), copy);
  truncateSync(copy, Math.floor(statSync(copy).size / 2));
  const { record, ...rest } = mapChild(copy);
  result.truncated = rest;
}

const bytes = allMaps.map((m) => m.bytes).sort((a, b) => a - b);
const cpu = allMaps.map((m) => m.cpuMs ?? 0).sort((a, b) => a - b);
result.mapCost = {
  childFiles: allMaps.length,
  medianBytes: bytes[Math.floor(bytes.length / 2)],
  maxBytes: bytes.at(-1),
  medianCpuMs: cpu[Math.floor(cpu.length / 2)],
  maxCpuMs: cpu.at(-1),
  totalCpuMs: Math.round(cpu.reduce((a, b) => a + b, 0)),
};
result.lateFile = existsSync(join(scratch, "out-forks/children-later.txt"))
  ? readFileSync(join(scratch, "out-forks/children-later.txt"), "utf8").split("\n").filter((l) => l.includes(".json")).length -
    readFileSync(join(scratch, "out-forks/children-at-end.txt"), "utf8").split("\n").filter((l) => l.includes(".json")).length
  : null;
result.load = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3);
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result.mapCost)} late=${result.lateFile}\n`);
