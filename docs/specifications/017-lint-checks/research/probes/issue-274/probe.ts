// Throwaway (issue #274 research). Times each sub-step of a config-mode oxlint
// `rekey()` on a fixture from make-fixture.mjs, with Squeal's own modules from
// this worktree's `src/`. Starts no daemon; opens a lint store only under the
// fixture's scratch folder. Run: node_modules/.bin/tsx probe.ts <fixture root> <out.json>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, posix } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldNow } from "node:timers/promises";
import { encodeSegment, keyFromSegments } from "../../../../../../src/core/keys/check-key.ts";
import { lintCheck } from "../../../../../../src/core/lint/pass/judge.ts";
import { Keyer } from "../../../../../../src/core/lint/pass/keyer.ts";
import { type KeyBasis, lintKey } from "../../../../../../src/core/lint/pass/keys.ts";
import type { LintFileInputs, LintProvider, LintSnapshot } from "../../../../../../src/core/lint/pass/provider.ts";
import { rekey } from "../../../../../../src/core/lint/pass/rekey.ts";
import type { LintSource, LintSourceFile } from "../../../../../../src/core/lint/pass/types.ts";
import { Unlisted } from "../../../../../../src/core/lint/pass/unlisted.ts";
import { chainOf, configIn, findConfigs } from "../../../../../../src/core/lint/provider/oxlint/configs.ts";
import { discoverOxlint } from "../../../../../../src/core/lint/provider/oxlint/discover.ts";
import { Preload } from "../../../../../../src/core/lint/provider/oxlint/preload.ts";
import { oxlintProvider } from "../../../../../../src/core/lint/provider/oxlint/provider.ts";
import { lintedFiles, type RunContext, runOxlint } from "../../../../../../src/core/lint/provider/oxlint/run.ts";
import { openLintStore } from "../../../../../../src/core/lint/store/open.ts";

const [root, outPath] = process.argv.slice(2) as [string, string];
const out: Record<string, unknown> = { root, cpus: cpus().length, node: process.version };

// --- measurement: wall, own CPU, reaped children's CPU, longest event-loop block ---
const TICK = Number(process.env.SC_TICK ?? 0.17); // /proc clock tick is 10 ms; children CPU is coarse
function childCpuMs(): number {
  const f = readFileSync("/proc/self/stat", "utf8").split(") ")[1]!.split(" ");
  return (Number(f[13]) + Number(f[14])) * 10; // cutime + cstime, 100 Hz
}
let lastTick = performance.now();
let blocks: { end: number; ms: number }[] = [];
let ticks = 0;
const ticker = setInterval(() => {
  ticks++;
  const now = performance.now();
  const gap = now - lastTick - 1;
  if (gap > 4) blocks.push({ end: now, ms: gap });
  lastTick = now;
}, 1);
void TICK;
async function measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  await yieldNow();
  lastTick = performance.now();
  blocks = [];
  ticks = 0;
  const load = loadavg()[0];
  const cpu0 = process.cpuUsage();
  const child0 = childCpuMs();
  const t0 = performance.now();
  const value = await fn();
  const wall = performance.now() - t0;
  // the block that ends the call is seen at the next tick
  await new Promise((r) => setTimeout(r, 3));
  const cpu = process.cpuUsage(cpu0);
  const maxBlock = Math.max(0, ...blocks.map((b) => b.ms), ...(ticks <= 1 ? [wall] : []));
  const row = {
    wallMs: +wall.toFixed(1),
    ownCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1),
    childCpuMs: childCpuMs() - child0,
    maxBlockMs: +maxBlock.toFixed(1),
    blocksOver50ms: blocks.filter((b) => b.ms > 50).length,
    load1: +load!.toFixed(2),
  };
  out[name] = row;
  console.log(name.padEnd(46), JSON.stringify(row));
  return value;
}
/** A synchronous call is one event-loop block by construction: its wall time. */
function sync<T>(name: string, fn: () => T): T {
  const load = loadavg()[0];
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const value = fn();
  const wall = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const row = { wallMs: +wall.toFixed(1), ownCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), maxBlockMs: +wall.toFixed(1), load1: +load!.toFixed(2) };
  out[name] = row;
  console.log(name.padEnd(46), JSON.stringify(row));
  return value;
}

// --- the fixture as a LintSource: git's listing and blob ids ---
const listed: LintSourceFile[] = execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .map((line) => {
    const [meta, path] = line.split("\t") as [string, string];
    return { path, hash: meta.split(" ")[1]! } as LintSourceFile;
  });
const files = new Map(listed.map((f) => [f.path, f]));
let revision = 1;
let changed: string[] = [];
const source: LintSource = {
  latestRevision: () => revision as never,
  changedPaths: () => changed as never,
  file: (p) => files.get(p) ?? null,
  files: () => [...files.values()],
  ignored: () => [],
};
const paths = [...files.keys()].sort();
out.files = paths.length;
out.loadavgStart = loadavg();

// --- the provider, opened as the pass opens it ---
const provider = oxlintProvider({ root: root as never });
await measure("open (discover + readConfigs, not in rekey)", () => provider.open("sha1"));
const snapshot = (await provider.refresh("instance")) as LintSnapshot;
out.declaration = snapshot.declaration;
out.closure = snapshot.closure;
const install = discoverOxlint(root as never) as Exclude<ReturnType<typeof discoverOxlint>, { off: string }>;
const preload = new Preload();
const ctx = (observe: boolean): RunContext => ({
  root: root as never, node: process.execPath, install, preload, observe, format: "sha1",
  env: process.env, guardMs: 60_000, signal: new AbortController().signal,
});

// --- Q1a: lintedFiles (DEBUG_CHUNK 256), observe on and off; other chunkings ---
const linted = (await measure("lintedFiles chunk=256 observe=true", () => lintedFiles(ctx(true), paths))) as Set<string>;
await measure("lintedFiles chunk=256 observe=false", () => lintedFiles(ctx(false), paths));
async function chunked(size: number, observe: boolean): Promise<Set<string>> {
  const set = new Set<string>();
  for (let i = 0; i < paths.length; i += size) {
    const run = await runOxlint(ctx(observe), ["--debug", "files", "--threads", "1", "--", ...paths.slice(i, i + size)]);
    for (const line of run.process.stdout.split("\n")) if (line.trim()) set.add(line.trim());
  }
  return set;
}
for (const size of [1024, 4096]) await measure(`debug files chunk=${size} observe=true`, () => chunked(size, true));
await measure("debug files chunk=4096 observe=false", () => chunked(4096, false));
const rootPass = await measure("debug files root pass (no paths) observe=true", async () => {
  const run = await runOxlint(ctx(true), ["--debug", "files", "--threads", "1"]);
  return new Set(run.process.stdout.split("\n").map((l) => l.trim()).filter(Boolean));
});
out.lintedCount = linted.size;
out.rootPassCount = rootPass.size;
out.rootPassEqual = linted.size === rootPass.size && [...linted].every((p) => rootPass.has(p));

// --- Q1b: chainOf over the linted files, today and memoized per folder ---
const lintedPaths = paths.filter((p) => linted.has(p));
const today = sync("chainOf/inputsOf all linted (existsSync walk)", () =>
  lintedPaths.map((p) => JSON.stringify({ chain: chainOf(root as never, p) })),
);
const memo = new Map<string, string | null>();
const memoChain = (file: string) => {
  const chain: [string, string | null][] = [];
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    const here = dir === "." ? "" : dir;
    let config = memo.get(here);
    if (config === undefined) memo.set(here, (config = configIn(root as never, here)));
    chain.push([here, config]);
    if (config !== null || here === "") return chain;
  }
};
const memoized = sync("chainOf memoized per folder (one pass)", () =>
  lintedPaths.map((p) => JSON.stringify({ chain: memoChain(p) })),
);
const found = new Set(await findConfigs(root as never));
const fromMap = (file: string) => {
  const chain: [string, string | null][] = [];
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    const here = dir === "." ? "" : dir;
    const names = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"];
    const hit = names.map((n) => (here ? `${here}/${n}` : n)).find((p) => found.has(p)) ?? null;
    chain.push([here, hit]);
    if (hit !== null || here === "") return chain;
  }
};
const mapped = sync("chainOf from findConfigs map (no fs)", () =>
  lintedPaths.map((p) => JSON.stringify({ chain: fromMap(p) })),
);
out.chainMemoIdentical = today.every((v, i) => v === memoized[i]);
out.chainMapIdentical = today.every((v, i) => v === mapped[i]);
out.existsSyncPerFile = +(
  lintedPaths.reduce((n, p) => n + chainOf(root as never, p).length * 4, 0) / lintedPaths.length
).toFixed(1);

// --- Q1c: Keyer.keys with the provider's inputs given, and a once-per-Keyer variant ---
const inputsMap = new Map<string, LintFileInputs>(
  lintedPaths.map((p, i) => [p, { config: today[i]!, wholeProgram: snapshot.declaration && false }]),
);
for (const whole of [false, true]) {
  const stub: LintProvider = {
    inputs: async (ps) => new Map(ps.flatMap((p) => (inputsMap.has(p) ? [[p, { ...inputsMap.get(p)!, wholeProgram: whole }]] : []))),
  } as LintProvider;
  const basis: KeyBasis = { snapshot, installed: "install-fp", nodeMajor: 26 };
  const unlisted = new Unlisted({ root: root as never, format: "sha1" });
  const keyer = new Keyer(basis, stub, source, unlisted, new Set());
  await keyer.inputs(lintedPaths);
  const keys = (await measure(`Keyer.keys importPlugin=${whole}`, () => keyer.keys(lintedPaths)))!;
  // once per Keyer: shared parts and config segments encoded once, env hash per distinct chain
  const fast = sync(`fast keys importPlugin=${whole}`, () => fastKeys(basis, keyer, whole, lintedPaths));
  out[`fastKeysIdentical importPlugin=${whole}`] = lintedPaths.every((p) => keys.get(p)?.key === fast.get(p));
}

function fastKeys(basis: KeyBasis, keyer: Keyer, whole: boolean, ps: string[]): Map<string, string> {
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const { declaration, packages, env, closure } = basis.snapshot;
  const sharedJson = JSON.stringify([
    "squeal-lint-key/4", declaration.tool, declaration.toolVersion, declaration.providerVersion, basis.nodeMajor,
    packages.length > 0 ? basis.installed : null,
    Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]).slice(0, -1); // without its closing bracket: the config is appended per chain
  const configs = [...new Set([...declaration.configFiles, ...closure])].sort();
  const configSegs = configs.map((p) => [p, encodeSegment(p as never, keyer.inputBlobOf(p as never))] as const);
  const envOf = new Map<string, string>();
  const segment = whole ? `program:${keyer.segment}` : "";
  const keys = new Map<string, string>();
  for (const path of ps) {
    const config = inputsMap.get(path)!.config;
    let env = envOf.get(config);
    if (env === undefined) envOf.set(config, (env = sha(`${sharedJson},${JSON.stringify(config)}]`)));
    const segs: string[] = [];
    let placed = false;
    for (const [p, seg] of configSegs) {
      if (!placed && path <= p) {
        if (path !== p) segs.push(encodeSegment(path as never, keyer.blobOf(path as never)));
        placed = true;
      }
      segs.push(seg);
    }
    if (!placed) segs.push(encodeSegment(path as never, keyer.blobOf(path as never)));
    keys.set(path, keyFromSegments(env as never, { project: declaration.tool, path } as never, segs, segment));
  }
  return keys;
}

// --- Q1d: the store side of judgeAll, then a whole config-mode rekey ---
const common = join(dirname(root), `${root.split("/").pop()}-common`);
rmSync(common, { recursive: true, force: true });
const store = openLintStore(common as never, { lint: { enabled: true } } as never) as Exclude<ReturnType<typeof openLintStore>, { reason: string }>;
const lint = { enabled: true, include: ["**"], exclude: [], blocking: false, tools: ["oxlint"] };
const unlisted = new Unlisted({ root: root as never, format: "sha1" });
const timing: Record<string, { n: number; ms: number; max: number }> = {};
const timed = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => {
  const t0 = performance.now();
  const r = fn(...a);
  const ms = performance.now() - t0;
  const s = (timing[name] ??= { n: 0, ms: 0, max: 0 });
  s.n++; s.ms += ms; s.max = Math.max(s.max, ms);
  return r;
};
const wrapped = {
  ...store,
  results: { ...store.results, get: timed("results.get", store.results.get) },
  transaction: timed("store.transaction", store.transaction),
};
const timedProvider: LintProvider = {
  ...provider,
  inputs: async (ps: readonly string[]) => {
    const t0 = performance.now();
    const r = await provider.inputs(ps as never);
    const s = (timing["provider.inputs (async)"] ??= { n: 0, ms: 0, max: 0 });
    s.n++; s.ms += performance.now() - t0;
    return r;
  },
} as LintProvider;
async function pass(label: string) {
  for (const k of Object.keys(timing)) delete timing[k];
  const snap = (await provider.refresh("instance")) as LintSnapshot;
  unlisted.read([...snap.declaration.configFiles, ...snap.closure], (p) => files.has(p));
  const basis: KeyBasis = { snapshot: snap, installed: "install-fp", nodeMajor: 26 };
  const keyer = new Keyer(basis, timedProvider, source, unlisted, new Set());
  const keyingCtx = { worktreeId: "wt" as never, tool: "oxlint" as const, store: wrapped as never, source, lint: lint as never, now: () => Date.now() as never, recorded: () => {}, readByLint: new Set<never>() };
  const r = await measure(`rekey ${label}`, () => rekey(keyingCtx, keyer, revision as never));
  out[`rekey ${label} parts`] = Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, { n: v.n, ms: +v.ms.toFixed(1), max: +v.max.toFixed(2) }]));
  out[`rekey ${label} result`] = r && { mode: r.mode, keyed: r.keyed, hits: r.hits };
  console.log("   parts", JSON.stringify(out[`rekey ${label} parts`]));
}
await pass("first");
// The incident: the two plugin rule files change; the closure moves, so every file re-keys.
for (const p of ["tools/lint/owner-reader-rules.ts", "tools/lint/test-enum-literal.ts"]) {
  files.set(p, { path: p, hash: createHash("sha1").update(`${p}-edited`).digest("hex") } as LintSourceFile);
}
revision = 2;
changed = ["tools/lint/owner-reader-rules.ts", "tools/lint/test-enum-literal.ts"];
await pass("config (2 plugin files edited)");

// The unknown pass: with lint.include narrowed, non-selected files of unlearned extensions
// are offered to --debug files again (rekey.ts inputsOf). Same edit, include narrowed.
(lint as { include: string[] }).include = ["packages/p0/**"];
for (const p of changed) files.set(p, { path: p, hash: createHash("sha1").update(`${p}-edited-again`).digest("hex") } as LintSourceFile);
revision = 3;
await pass("config, include packages/p0/** (unknown pass)");
(lint as { include: string[] }).include = ["**"];

// --- Q3: the same store work, sliced with setImmediate every 256 files ---
const keyed = [...linted].map((p) => [p, createHash("sha256").update(p).digest("hex")] as const);
await measure("results.get x N, one block", () => { for (const [p, k] of keyed) store.results.get(lintCheck(p as never, "oxlint"), k as never); });
await measure("results.get x N, yield every 256", async () => {
  for (let i = 0; i < keyed.length; i++) {
    if (i % 256 === 0) await yieldNow();
    const [p, k] = keyed[i]!;
    store.results.get(lintCheck(p as never, "oxlint"), k as never);
  }
});

out.loadavgEnd = loadavg();
clearInterval(ticker);
store.close();
await provider.close();
preload.remove();
rmSync(common, { recursive: true, force: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
