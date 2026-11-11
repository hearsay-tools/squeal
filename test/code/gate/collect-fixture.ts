import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";
import { ADAPTERS } from "../../../src/cli/code-gate.js";
import { countFile } from "../../../src/core/code/count/index.js";
import { type CollectOptions, collectEvidence } from "../../../src/core/code/gate/collect.js";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import { loadBasePolicy } from "../../../src/core/code/gate/policy.js";
import type { GateAdapters } from "../../../src/core/code/gate/runners.js";
import { type GateScope, readScope, resolveScope } from "../../../src/core/code/gate/scope.js";
import type { ChangedSet, CountedPath, Evidence } from "../../../src/core/code/gate/types.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { Policy } from "../../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../../src/core/types/runner.js";
import { git, initRepo } from "../../hash/git-repo.js";
import { TIMES, VERSIONS } from "./evaluate-fixture.js";

/*
 * Spec 020 D3 (row 020-03): fixture projects for the one-shot collector,
 * copied under the fixtures' git-ignored `.tmp/`, so `vitest` resolves from
 * the repository's `node_modules`, each a git repository of its own.
 */

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/code/gate");
const SCRATCH = join(FIXTURES, ".tmp");

/** The adapters as the CLI gives them (row 020-05). */
export { ADAPTERS };

/** Adapters that throw when started: a case that must start none. */
export const NO_ADAPTERS: GateAdapters = {
  vitest: () => Promise.reject(new Error("the Vitest adapter started")),
  nodeTest: () => Promise.reject(new Error("a node:test adapter started")),
};

/**
 * `adapter` with `before` called on each run's files and options; the run
 * gets the files `before` returns.
 */
export function onRun(
  adapter: RunnerAdapter,
  before: (files: readonly TestFileRef[], options: RunOptions) => readonly TestFileRef[],
): RunnerAdapter {
  return new Proxy(adapter, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (key !== "run") return value.bind(target);
      return (files: readonly TestFileRef[], options: RunOptions) =>
        target.run(before(files, options), options);
    },
  });
}

/** The CLI's adapters, each Vitest run's files appended to `ran`. */
export function watched(ran: string[]): GateAdapters {
  const record = (files: readonly TestFileRef[]) => {
    ran.push(...files.map((f) => f.path));
    return files;
  };
  return { ...ADAPTERS, vitest: async (options) => onRun(await ADAPTERS.vitest(options), record) };
}

/** Each case starts real Vitest instances and node:test processes; a loaded host needs headroom. */
export const SLOW = { timeout: 120_000 } as const;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A committed copy of `test/fixtures/code/gate/<name>`, removed after the test. */
export function project(name: string): string {
  mkdirSync(SCRATCH, { recursive: true });
  const root = join(SCRATCH, `${name}-${randomUUID()}`);
  cpSync(join(FIXTURES, name), root, { recursive: true });
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  initRepo(root, {});
  return root;
}

/**
 * A `TMPDIR` of the test's own while it runs, so a test can see that the
 * collector leaves nothing there. Restored, and removed, after the test.
 */
export function ownTmpdir(): () => readonly string[] {
  const before = process.env.TMPDIR;
  const dir = mkdtempSync(join(tmpdir(), "squeal-gate-test-"));
  process.env.TMPDIR = dir;
  cleanups.push(() => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(dir, { recursive: true, force: true });
  });
  return () => readdirSync(dir);
}

/** What `git status` lists, ignored paths included. */
export function status(root: string): string {
  return git(root, ["status", "--porcelain", "--ignored", "--untracked-files=all"]);
}

/** The `ChangedSet` of `paths` at their bytes now, every function edited. */
export async function changedSet(root: string, paths: readonly string[]): Promise<ChangedSet> {
  const counted: CountedPath[] = await Promise.all(
    [...paths].sort().map(async (path) => {
      const bytes = readFileSync(join(root, path));
      const blob = blobHash(bytes, "sha1");
      const count = await countFile(bytes.toString("utf8"), "typescript", blob);
      return { path, blob, functions: count.functions };
    }),
  );
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  return {
    ref: "HEAD",
    baseCommit: head,
    headCommit: head,
    dirty: false,
    paths: counted.map((c) => c.path),
    functions: counted.flatMap(({ path, blob, functions }) =>
      functions.map((count) => ({ path, blob, change: "edited" as const, count })),
    ),
    counted,
    inErrors: [],
    uncounted: [],
  };
}

/**
 * The collector over the fixture: a 600 s budget and the CLI's adapters,
 * `options` on top. Its notes and the `prepare` output are kept.
 */
export async function collect(
  root: string,
  changed: ChangedSet,
  options: Partial<CollectOptions> = {},
): Promise<{ evidence: Evidence; notes: string[]; output: string }> {
  const notes: string[] = [];
  let output = "";
  const evidence = await collectEvidence(root as AbsolutePath, changed, {
    tests: [],
    budgetSeconds: 600,
    adapters: ADAPTERS,
    note: (text) => notes.push(text),
    output: (text) => {
      output += text;
    },
    ...options,
  });
  return { evidence, notes, output };
}

/** The report of `evidence` under the policy read at the fixture's commit, and each function's state and gap. */
export async function judged(root: string, changed: ChangedSet, evidence: Evidence) {
  const { policy } = await loadBasePolicy(root as AbsolutePath, changed.baseCommit);
  const report = evaluate(changed, evidence, policy, VERSIONS, TIMES);
  return { report, states: report.functions.map((f) => [f.qualifiedName, f.state, f.gap]) };
}

/**
 * The fixture's scope at its own commit, with `--group` names `added`;
 * `checks` stand for the policy's when given.
 */
export function scopeOf(
  root: string,
  added: readonly string[] = [],
  checks?: Policy["checks"],
): GateScope {
  const { policy } = loadPolicy(root);
  const read = readScope(checks === undefined ? policy : { ...policy, checks });
  const scope = resolveScope(read.base, added);
  if ("error" in scope) throw new Error(scope.error);
  return scope;
}
