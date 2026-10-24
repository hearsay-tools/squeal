// Throwaway probe for research 016-13 (observed-paths.md). Not product code.
// Run: SCRATCH=$(mktemp -d /tmp/obs-probe.XXXX) npx tsx probe.ts
// It builds a scratch git repository under $SCRATCH, runs the real node:test
// adapter on it once with a stub ObservedStore, then feeds the same
// observations to the core's `observedGrowth` with a stub context, and reads
// a node:test-shaped meta value through the core's `ObservedSets`.
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ObservedSets, observedMetaKey } from "../../../../../../src/core/keys/observed.js";
import { observedGrowth } from "../../../../../../src/core/scheduler/observed.js";
import { linkTargets } from "../../../../../../src/core/scheduler/link-target.js";
import { createNodeTestAdapter } from "../../../../../../src/runners/node-test/adapter.js";

const scratch = realpathSync(process.env.SCRATCH ?? "");
const root = join(scratch, "repo");
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, ".gitignore"), "dist/\n");
writeFileSync(join(root, "src", "y.mjs"), "export const y = 1;\n");
writeFileSync(join(root, "dist", "x.mjs"), "export const x = 2;\n");
symlinkSync("src", join(root, "lnk"));
// Computed specifiers: the static graph cannot see either import.
writeFileSync(
  join(root, "t.test.mjs"),
  [
    'import test from "node:test";',
    'const dir = ["di", "st"].join("");',
    'const { x } = await import(`./${dir}/x.mjs`);',
    'const { y } = await import(`./${"src"}/y.mjs`);',
    'test("sum", () => { if (x + y !== 3) throw new Error("bad"); });',
    "",
  ].join("\n"),
);
execFileSync("git", ["init", "-q"], { cwd: root });
execFileSync("git", ["add", "."], { cwd: root });

// 1. The injected path: what the node:test adapter writes to its store, and its closure().
const writes: unknown[] = [];
const store = {
  read: () => ({}),
  write: (a: unknown) => writes.push({ write: a }),
  readPreloads: () => [],
  writePreloads: (a: unknown) => writes.push({ writePreloads: a }),
};
const project = { name: "p", argv: [], env: {}, include: ["t.test.mjs"] };
const adapter = await createNodeTestAdapter(project, {
  root,
  observed: store,
  note: (t) => console.log("note:", t),
});
const ref = { project: "p", path: "t.test.mjs" };
const before = await adapter.closure(ref);
const logDir = join(scratch, "logs");
mkdirSync(logDir);
const report = await adapter.run([ref], { runId: "r1", logDir, timeoutMs: 60_000 });
const after = await adapter.closure(ref);
await adapter.close();
console.log("1. node:test run:", report.results.map((r) => `${r.check.fullName}=${r.outcome}`));
console.log("   static closure before the run:", before.paths);
console.log("   store writes:", JSON.stringify(writes));
console.log("   closure() after the run:", after.paths);

// 2. The core's path over the same observations (stub context: empty closure, nothing hashed before).
const tracked: string[] = [];
const context = {
  root,
  keys: {
    observing: true,
    refreshObserved: () => {},
    index: { closure: () => ({ paths: before.paths }) },
    listingsBelow: () => [],
    observedOf: () => [],
    track: async (p: string[]) => void tracked.push(...p),
    firstHashedDuringRun: (p: string) => p === "src/y.mjs",
  },
} as never;
const observed = [{ testFile: ref, paths: ["dist/x.mjs", "src/y.mjs"], directories: [] }];
const growth = await observedGrowth(context, { observed } as never, 1);
console.log("2. core observedGrowth:", JSON.stringify(Object.fromEntries(growth)));
console.log("   tracked into the stat cache:", tracked);

// 3. Link targets: a real path (what node:test and pytest record) adds nothing; a link path adds its target.
console.log("3. linkTargets(real src/y.mjs):", await linkTargets(root, ["src/y.mjs"]));
console.log("   linkTargets(link lnk/y.mjs):", await linkTargets(root, ["lnk/y.mjs"]));

// 4. A node:test meta value copied under the core's key reads back through ObservedSets for any runner's project.
const meta = new Map<string, string>();
const fakeStore = {
  meta: { get: (k: string) => meta.get(k) ?? null, set: (k: string, v: string) => void meta.set(k, v) },
  transaction: (fn: () => void) => fn(),
} as never;
const nodeTestValue = JSON.stringify({ "t.test.mjs": ["dist/x.mjs", "src/y.mjs"] });
meta.set(observedMetaKey("p"), nodeTestValue);
const sets = new ObservedSets(fakeStore);
console.log("4. ObservedSets.of(p, t.test.mjs) over a nodeTest.observed value:", sets.of(ref));
