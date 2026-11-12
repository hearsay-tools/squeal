// Throwaway probe for row 021-30, step 1: does the stored import graph give the same affected
// set as Vitest's walk? Runs only inside the scratch setup.sh makes, with its HOME, XDG_* and
// TMPDIR, through tsx:
//   tsx survey.mts <scratch> <edits.json out> <results.jsonl out>
// One Vitest runner host (the clone's own bundle) through Squeal's proxy. It lists the test
// files, reads the environment and every test file's closure: that is what the daemon stores
// (`recordImportGraph`: each closure's `imports` by key, the environment's files and walks).
// Then per edit: change the files on disk, `invalidate`, `affected` (Vitest's answer), the
// graph's answer from the closures read before the edit, then restore and `invalidate` again.
// Prints one JSON line per edit. Never runs a test.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { encodeImports } from "../../../../../src/core/store/import-edges.ts";
import { spawnRunnerHost } from "../../../../../src/core/runner-host/channel.ts";
import { startHostProxy } from "../../../../../src/core/runner-host/proxy.ts";
import { hostedOptions } from "../../../../../src/core/runner-host/vitest-host.ts";

type Ref = { project: string; path: string };
type Walk = Map<string, { static: string[]; dynamic: string[] }>;
type Edit = { label: string; kind: "change" | "delete" | "add"; paths: string[]; body?: string };
type Answer = { direct: string[]; transitive: string[] };

const [scratch, editsOut, resultsOut] = process.argv.slice(2);
const root = join(scratch!, "squeal");
const cli = join(root, "plugins/claude-code/dist/cli/squeal.mjs");
const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const id = (r: Ref) => `${r.project}\0${r.path}`;
const out: string[] = [];
const log = (o: Record<string, unknown>) => {
  const line = JSON.stringify({ t: new Date().toISOString(), load1: load1(), ...o });
  out.push(line);
  console.log(line);
};

const t0 = performance.now();
const channel = spawnRunnerHost({ execPath: process.execPath, execArgv: [], cli }, root as never, "vitest");
const { options, policy } = hostedOptions({
  root: root as never,
  maxWorkers: 1,
  observe: () => false,
  exclude: () => ["test/e2e/**"],
} as never);
const adapter = await startHostProxy({ channel, runner: "vitest", version: "0.1.461", options, policy });
const files = (await adapter.testFiles()) as Ref[];
const environments = await adapter.environment();
log({ step: "start", ms: Math.round(performance.now() - t0), files: files.length });

// With SURVEY_COLD=1, the cold host's first `affected`, as after a reopen (D20.6).
if (process.env.SURVEY_COLD === "1") {
  const c0 = performance.now();
  const first = await adapter.affected(["test/keys/key-format.test.ts" as never]);
  log({ step: "cold-affected", ms: Math.round(performance.now() - c0), direct: first.direct.length });
}

// What the daemon holds and stores, read before any edit.
const t1 = performance.now();
const paths = new Map<string, Set<string>>();
const walks = new Map<string, Walk>();
for (const ref of files) {
  const closure = await adapter.closure(ref as never);
  paths.set(id(ref), new Set(closure.paths));
  const walk: Walk = new Map();
  for (const f of closure.imports ?? []) walk.set(f.path, { static: [...f.static], dynamic: [...f.dynamic] });
  walks.set(id(ref), walk);
}
const envFiles = new Map(environments.map((e) => [e.project, new Set(e.files)]));
log({ step: "closures", ms: Math.round(performance.now() - t1) });

// What reading every stored walk costs: the blobs `encodeImports` writes, inflated and parsed.
{
  const blobs = files.map((ref) =>
    encodeImports([...walks.get(id(ref))!].map(([path, e]) => ({ path, sha1: "", ...e })) as never),
  );
  const d0 = performance.now();
  let entries = 0;
  for (const blob of blobs) entries += (JSON.parse(inflateRawSync(blob).toString("utf8")) as unknown[]).length;
  log({
    step: "decode-all",
    walks: blobs.length,
    bytes: blobs.reduce((n, b) => n + b.length, 0),
    entries,
    ms: Math.round(performance.now() - d0),
  });
  if (process.env.SURVEY_COST_ONLY === "1") {
    writeFileSync(resultsOut!, `${out.join("\n")}\n`);
    await adapter.close();
    process.exit(0);
  }
}

// The edits: chosen once with a fixed seed, written out, so a rerun repeats them.
let seed = 30;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const reach = new Map<string, number>();
for (const set of paths.values()) for (const p of set) reach.set(p, (reach.get(p) ?? 0) + 1);
const sources = [...reach.keys()].filter((p) => existsSync(join(root, p)) && /\.(ts|js|mjs|cjs|json)$/.test(p)).sort();
const testPaths = new Set(files.map((f) => f.path));
const pick = (pred: (p: string) => boolean, n: number) => {
  const pool = sources.filter(pred);
  const chosen: string[] = [];
  while (chosen.length < n && pool.length > 0) chosen.push(...pool.splice(Math.floor(rand() * pool.length), 1));
  return chosen;
};
const nonTest = (p: string) => !testPaths.has(p);
const edits: Edit[] = [];
const bucket = (lo: number, hi: number, n: number, tag: string) => {
  for (const p of pick((p) => nonTest(p) && reach.get(p)! >= lo && reach.get(p)! <= hi, n))
    edits.push({ label: `${tag}:${p}`, kind: "change", paths: [p] });
};
bucket(1, 1, 3, "src-1");
bucket(2, 5, 3, "src-2to5");
bucket(6, 30, 3, "src-6to30");
bucket(31, 200, 3, "src-31to200");
bucket(201, 1e9, 3, "src-201up");
for (const p of pick((p) => testPaths.has(p), 3)) edits.push({ label: `test:${p}`, kind: "change", paths: [p] });
const helper = pick((p) => p.startsWith("test/") && nonTest(p) && !p.includes("fixtures"), 1);
for (const p of helper) edits.push({ label: `test-helper:${p}`, kind: "change", paths: [p] });
const json = pick((p) => p.endsWith(".json") && nonTest(p), 1);
for (const p of json) edits.push({ label: `json:${p}`, kind: "change", paths: [p] });
const dynamicTargets = new Set<string>();
for (const walk of walks.values()) for (const e of walk.values()) for (const d of e.dynamic) dynamicTargets.add(d);
for (const p of pick((p) => dynamicTargets.has(p) && nonTest(p), 1))
  edits.push({ label: `dynamic:${p}`, kind: "change", paths: [p] });
const two = pick(nonTest, 2);
edits.push({ label: "two-sources", kind: "change", paths: two });
// A source no closure names: imported only as a type, so the transform drops the import.
edits.push({ label: "type-only:src/core/types/runner.ts", kind: "change", paths: ["src/core/types/runner.ts"] });
const mixed = [...pick((p) => testPaths.has(p), 1), ...pick(nonTest, 1), ...pick((p) => p.endsWith(".json"), 1)];
edits.push({ label: "mixed-three", kind: "change", paths: mixed });
edits.push({ label: "config", kind: "change", paths: ["vitest.config.ts"] });
edits.push({ label: "global-setup", kind: "change", paths: ["test/global-teardown.ts"] });
edits.push({ label: "runtime-read", kind: "change", paths: ["test/fixtures/vitest/basic/test/__snapshots__/strings.test.ts.snap"] });
for (const p of pick((p) => nonTest(p) && reach.get(p)! <= 5 && p.startsWith("src/"), 1))
  edits.push({ label: `delete:${p}`, kind: "delete", paths: [p] });
edits.push({ label: "add-source", kind: "add", paths: ["src/core/probe-021-30.ts"], body: "export const probe = 1;\n" });
const target = sources.find((p) => p.startsWith("src/core/") && nonTest(p))!;
const rel = target.replace(/^src\/core\//, "../src/core/").replace(/\.ts$/, ".js");
edits.push({
  label: "add-test",
  kind: "add",
  paths: ["test/probe-021-30.test.ts"],
  body: `import { expect, it } from "vitest";\nimport * as m from "${rel.replace("../src", "../src")}";\nit("probe", () => expect(m).toBeDefined());\n`,
});
const firstTest = files.find((f) => f.path.startsWith("test/") && f.path.split("/").length === 3)!;
edits.push({
  label: "add-snapshot",
  kind: "add",
  paths: [join(dirname(firstTest.path), "__snapshots__", `${firstTest.path.split("/").pop()}.snap`)],
  body: "// Vitest Snapshot v1\n",
});
const missing = [...reach.keys()].filter((p) => !existsSync(join(root, p)) && !p.endsWith(".snap")).sort();
if (missing[0] !== undefined) edits.push({ label: `add-missing-candidate:${missing[0]}`, kind: "add", paths: [missing[0]], body: "export {};\n" });
writeFileSync(editsOut!, `${JSON.stringify(edits, null, 2)}\n`);

/**
 * The graph's answer from the closures read before the edit, two ways. `walk`: a test file
 * reaches a path its stored walk visits (an importer or a target); `paths`: a path its closure
 * names. Both: a test file is direct when it is a changed path, imports one in its own entry,
 * or owns a changed snapshot; every test file of a project whose environment files hold a
 * changed path is affected.
 */
function graphAnswer(changed: string[], by: "walk" | "paths"): Answer {
  const direct: string[] = [];
  const transitive: string[] = [];
  for (const ref of files) {
    const walk = walks.get(id(ref))!;
    const named = paths.get(id(ref))!;
    const own = walk.get(ref.path);
    const visited = new Set<string>();
    for (const [importer, e] of walk) {
      visited.add(importer);
      for (const p of [...e.static, ...e.dynamic]) visited.add(p);
    }
    const reaches = (p: string) => p === ref.path || (by === "walk" ? visited.has(p) : named.has(p));
    const isDirect = changed.some(
      (p) =>
        p === ref.path ||
        own?.static.includes(p) ||
        own?.dynamic.includes(p) ||
        (p.endsWith(".snap") && named.has(p)),
    );
    const env = changed.some((p) => envFiles.get(ref.project)?.has(p));
    if (!changed.some(reaches) && !env && !isDirect) continue;
    (isDirect ? direct : transitive).push(ref.path);
  }
  return { direct: direct.sort(), transitive: transitive.sort() };
}

const diff = (a: string[], b: string[]) => ({
  onlyVitest: a.filter((x) => !b.includes(x)),
  onlyGraph: b.filter((x) => !a.includes(x)),
});

const originals = new Map<string, string | null>();
try {
  for (const edit of edits) {
    for (const p of edit.paths) {
      const abs = join(root, p);
      originals.set(p, existsSync(abs) ? readFileSync(abs, "utf8") : null);
      if (edit.kind === "delete") rmSync(abs);
      else if (edit.kind === "add") {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, edit.body ?? "");
      } else {
        const tail = p.endsWith(".json") ? "\n" : /\.(ts|js|mjs|cjs|snap)$/.test(p) ? "\n// probe 021-30\n" : "\nprobe 021-30\n";
        writeFileSync(abs, `${originals.get(p)}${tail}`);
      }
    }
    const a = performance.now();
    const inv = await adapter.invalidate(edit.paths.map((path) => ({ path, kind: edit.kind }) as never));
    if (edit.kind !== "change") await adapter.testFiles();
    const b = performance.now();
    const vitest = await adapter.affected(edit.paths as never);
    const c = performance.now();
    const v: Answer = {
      direct: vitest.direct.map((r) => r.path).sort(),
      transitive: vitest.transitive.map((r) => r.path).sort(),
    };
    const results: Record<string, unknown> = {};
    for (const by of ["walk", "paths"] as const) {
      const g0 = performance.now();
      const g = graphAnswer(edit.paths, by);
      const g1 = performance.now();
      results[by] = {
        ms: Math.round((g1 - g0) * 10) / 10,
        same: JSON.stringify(g) === JSON.stringify(v),
        direct: diff(v.direct, g.direct),
        transitive: diff(v.transitive, g.transitive),
      };
    }
    log({
      step: "edit",
      label: edit.label,
      kind: edit.kind,
      paths: edit.paths,
      recreated: inv.recreatedProjects,
      invalidateMs: Math.round(b - a),
      affectedMs: Math.round(c - b),
      vitest: { direct: v.direct.length, transitive: v.transitive.length },
      ...results,
    });
    for (const p of edit.paths) {
      const abs = join(root, p);
      const before = originals.get(p);
      if (before === null || before === undefined) rmSync(abs, { force: true });
      else writeFileSync(abs, before);
      originals.delete(p);
    }
    const back = edit.kind === "add" ? "delete" : edit.kind === "delete" ? "add" : "change";
    await adapter.invalidate(edit.paths.map((path) => ({ path, kind: back }) as never));
    if (edit.kind !== "change") await adapter.testFiles();
  }
} finally {
  for (const [p, before] of originals) {
    const abs = join(root, p);
    if (before === null || before === undefined) rmSync(abs, { force: true });
    else writeFileSync(abs, before);
  }
  writeFileSync(resultsOut!, `${out.join("\n")}\n`);
  await adapter.close();
}
