import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { POLICY_FILE } from "../../src/core/daemon/policy.js";
import { readSlowSkips, slowTierText } from "../../src/core/state/index.js";
import {
  DEFAULT_POLICY,
  type NodeTestProject,
  type Policy,
  type SlowPrecondition,
  type Store,
} from "../../src/core/types/index.js";
import {
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
} from "../scheduler/helpers.js";

/*
 * The scheduler over real Vitest runs with a slow tier and a precondition
 * (spec 004 D7, D8 as amended 2026-10-17, task 004-65). In the `basic`
 * fixture `test/strings.test.ts` and `test/upper.test.ts` are slow here.
 */

export const STRINGS = "test/strings.test.ts";
export const UPPER = "test/upper.test.ts";
export const SLOW_FILES = [STRINGS, UPPER];
export const NODE = process.execPath;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export interface OpenOptions {
  /** Before the scheduler starts, with the worktree written. */
  readonly setup?: (h: Harness) => void;
  readonly reloadPolicy?: HarnessOptions["reloadPolicy"];
  /** node:test projects beside Vitest, as policy and adapters both list them. */
  readonly nodeTest?: readonly NodeTestProject[];
  /** Before the harness opens: node:test adapters list their files when created. */
  readonly files?: Readonly<Record<string, string>>;
  /** Waits for the baseline to end; `false` returns once the scheduler started. */
  readonly idle?: boolean;
}

/** The policy `slow` with `precondition`, the fixture's two slow files at one at a time. */
export function slowPolicy(precondition: SlowPrecondition, include = SLOW_FILES): Policy["slow"] {
  return { ...DEFAULT_POLICY.slow, include, maxParallel: 1, precondition };
}

export async function open(precondition: SlowPrecondition, options: OpenOptions = {}) {
  const repo = createRepo();
  const store = openRepoStore(repo.commonDir);
  for (const [path, content] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), content);
  }
  return start(repo.main, repo.commonDir, store, precondition, options);
}

/**
 * A daemon restart over `h`'s worktree: `h`'s scheduler closed, the store
 * opened again, a new scheduler with the same policy started on it.
 */
export async function reopen(
  h: Harness,
  precondition: SlowPrecondition,
  options: OpenOptions = {},
) {
  await h.scheduler.close();
  const commonDir = h.store.worktrees.get(h.worktreeId)?.commonDir;
  if (commonDir === undefined) throw new Error("the harness registered no worktree");
  return start(h.root, commonDir, openRepoStore(commonDir), precondition, options);
}

async function start(
  root: string,
  commonDir: string,
  store: Store,
  precondition: SlowPrecondition,
  options: OpenOptions,
) {
  const repo = { main: root, commonDir };
  const slotDir = scratch("squeal-004-65-slot-");
  const slow = slowPolicy(precondition);
  const nodeTest = options.nodeTest ?? [];
  // Headers read the policy on disk: the scheduler's is the same.
  writeFileSync(join(repo.main, POLICY_FILE), JSON.stringify({ slow, nodeTest }));
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: { slow, nodeTest },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    ...(nodeTest.length === 0 ? {} : { nodeTest }),
    ...(options.reloadPolicy === undefined ? {} : { reloadPolicy: options.reloadPolicy }),
  });
  options.setup?.(h);
  // The harness registers no worktree row; the slow-tier line finds the policy through it.
  const worktree = { root: h.root, commonDir: repo.commonDir, isMain: true, daemon: null };
  store.worktrees.upsert({ id: h.worktreeId, registeredAt: 1, ...worktree });
  await h.scheduler.start();
  if (options.idle !== false) await h.scheduler.idle();
  return h;
}

export const slowRuns = (h: Harness, files = SLOW_FILES) =>
  h.runner.runs
    .map((run) => run.files.map((f) => f.path))
    .filter((paths) => paths.some((f) => files.includes(f)));
export const pendingSlow = (h: Harness) =>
  h.store.testFileKeys
    .list(h.worktreeId)
    .filter((row) => row.pending !== null && SLOW_FILES.includes(row.testFile.path));
export const line = (h: Harness) => slowTierText(h.header(), "squeal") ?? "";
/** The reasons of the skips the daemon keeps in the store, in one; `null` with none. */
export const skipReason = (h: Harness) => {
  const skips = readSlowSkips(h.store, h.worktreeId);
  return skips.length === 0 ? null : skips.map((skip) => skip.reason).join("; ");
};
