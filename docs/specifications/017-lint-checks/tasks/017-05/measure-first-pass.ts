/*
 * 017-05: the lint pass's own cost over a repository's tracked files, with a
 * fake provider that answers at once with no finding and makes no CPU load
 * (011's rule, 2026-10-26). Measures the pass's keying, lookups, store
 * writes and leases: a first pass, a second worktree at the same keys, and a
 * one-file edit (its computed config moved, so its bytes on disk still match
 * its blob). The pool is a fresh directory, so no permit of the user's own
 * pool is taken. Run from the worktree root:
 *
 *   npx tsx docs/specifications/017-lint-checks/tasks/017-05/measure-first-pass.ts [root]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { createLintPass } from "../../../../../src/core/lint/pass/index.js";
import type {
  LintProvider,
  LintPassReport,
  LintSource,
} from "../../../../../src/core/lint/pass/index.js";
import { TierCapacity } from "../../../../../src/core/scheduler/capacity.js";
import { DEFAULT_POLICY } from "../../../../../src/core/types/index.js";

const root = resolve(process.argv[2] ?? ".");
const LINTED = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx"]);

/** Tracked regular files and their index blobs. */
const files = execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .flatMap((line) => {
    const match = /^(\d+) ([0-9a-f]+) \d\t(.+)$/.exec(line);
    return match?.[1] === "100644" || match?.[1] === "100755"
      ? [{ path: match[3] as string, hash: match[2] as string }]
      : [];
  });
const byPath = new Map(files.map((f) => [f.path, f]));
let revision = 1;
let changed: string[] = [];
const source: LintSource = {
  latestRevision: () => revision,
  changedPaths: (after, upTo) => (after < upTo && upTo === revision ? changed : []),
  file: (path) => byPath.get(path) ?? null,
  files: () => [...byPath.values()],
  ignored: () => [],
};

const declaration = {
  tool: "eslint" as const,
  toolVersion: "9.30.0",
  providerVersion: 1,
  configFiles: ["eslint.config.js"],
};
const environment = { closure: [], packages: [], program: [], env: {} };
/** The edited file: its computed config moves, as an edit's would re-key it. */
let edited: string | null = null;
const fake: LintProvider = {
  open: () => Promise.resolve(declaration),
  refresh: () => Promise.resolve({ declaration, ...environment }),
  inputs: (paths) =>
    Promise.resolve(
      new Map(
        paths
          .filter((p) => LINTED.has(extname(p)))
          .map((p) => [p, { config: p === edited ? '{"edited":1}' : "{}", wholeProgram: false }]),
      ),
    ),
  lint: (part) =>
    Promise.resolve({
      results: new Map(part.map((f) => [f.path, { findings: [] }])),
      ...environment,
    }),
  close: () => Promise.resolve(),
};

/** The host's busy and total jiffies, from `/proc/stat`. */
function hostTicks(): { busy: number; total: number } {
  const cpu = readFileSync("/proc/stat", "utf8").split("\n")[0]?.trim().split(/\s+/).slice(1);
  const ticks = (cpu ?? []).map(Number);
  const idle = (ticks[3] ?? 0) + (ticks[4] ?? 0);
  const total = ticks.reduce((a, b) => a + b, 0);
  return { busy: total - idle, total };
}

const scratch = mkdtempSync(join(tmpdir(), "squeal-lint-measure-"));
const commonDir = join(scratch, ".git");
mkdirSync(commonDir);
const pool = new TierCapacity({ dir: join(scratch, "pool") }, "measure", () => {});
const policy = { ...DEFAULT_POLICY, lint: { ...DEFAULT_POLICY.lint, enabled: true } };

async function measure(name: string, worktreeId: string, setup: () => Promise<void> | void) {
  const reports: LintPassReport[] = [];
  const pass = createLintPass({
    worktreeId,
    root,
    commonDir,
    format: "sha1",
    source,
    policy: () => policy,
    provider: () => fake,
    capacity: () => pool,
    log: () => {},
    onError: (error) => console.error(error),
    onPass: (report) => reports.push(report),
  });
  const run = async () => {
    pass.nudge();
    await pass.idle();
  };
  await setup.call(null);
  if (name === "one-file edit") {
    await run();
    edited = files.find((f) => f.path === "src/core/lint/fingerprint.ts")?.path ?? null;
    revision = 2;
    changed = edited === null ? [] : [edited];
  }
  const host = hostTicks();
  const cpu = process.cpuUsage();
  const load = loadavg()[0];
  const started = performance.now();
  await run();
  const wall = performance.now() - started;
  const used = process.cpuUsage(cpu);
  const after = hostTicks();
  const busyCores = ((after.busy - host.busy) / (after.total - host.total)) * availableParallelism();
  await pass.close();
  console.log(
    JSON.stringify({
      name,
      wallMs: Math.round(wall),
      cpuMs: Math.round((used.user + used.system) / 1000),
      hostBusyCores: Math.round(busyCores * 10) / 10,
      load1: load,
      cores: availableParallelism(),
      report: reports.at(-1),
    }),
  );
}

console.log(JSON.stringify({ root, tracked: files.length }));
try {
  await measure("first pass", "w1", () => {});
  await measure("second worktree, every key a hit", "w2", () => {});
  await measure("one-file edit", "w1", () => {});
} finally {
  pool.close();
  rmSync(scratch, { recursive: true, force: true });
}
