import { loadPolicy } from "../core/daemon/policy.js";
import { findWorktreeRoot, worktreeIdFor } from "../core/fs/index.js";
import { durationOf } from "../core/scheduler/files.js";
import { slowFiles } from "../core/slow/classify.js";
import { withStatusStore } from "../core/status/index.js";
import { plural } from "../core/text.js";
import {
  type AbsolutePath,
  checkpointMetaKey,
  parseCheckpointProgress,
  type Store,
  type WorktreeId,
} from "../core/types/index.js";
import type { CliIo } from "./main.js";
import { runCommand } from "./run.js";
import { readRepoFacts } from "./setup/repo.js";
import { startCommand } from "./start.js";

/*
 * `squeal warmup`, spec 005 D3 step 4 (the human, 2026-10-12): `squeal
 * start`, then `squeal run --all --wait` on this terminal's daemon, which a
 * session's end does not stop. No questions and no writes; what it finds is
 * printed as a suggestion naming the `squeal setup` that would apply it.
 * `squeal setup`'s warm-up step runs the same code.
 */

export const WARMUP_USAGE = "usage: squeal warmup\n";

/** 004 D1's note: a fast file that ran longer than this is a slow candidate. */
export const SLOW_CANDIDATE_MS = 30_000;

/** How often the progress line is refreshed from the store. */
const PROGRESS_POLL_MS = 1_000;

/** A fast test file whose last run exceeded `SLOW_CANDIDATE_MS`. */
export interface SlowCandidate {
  readonly path: string;
  readonly durationMs: number;
}

export interface WarmupResult {
  /** `run --all --wait`'s: 0, 1 on known failures, 3 without a verdict (spec 005 D1). */
  readonly code: 0 | 1 | 3;
  readonly slowCandidates: readonly SlowCandidate[];
}

/** Exit 0, 1 or 3 as `run --all --wait`; 1 outside a git worktree, 2 on a usage error. */
export async function warmupCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length > 0) {
    io.stderr(`squeal warmup: takes no arguments\n${WARMUP_USAGE}`);
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal warmup: ${cwd} is not inside a git worktree\n`);
    return 1;
  }
  const result = await warmUp(root, io);
  const suggestions = [
    ...result.slowCandidates.map(
      (c) =>
        `${c.path} ran ${Math.round(c.durationMs / 1000)} s, over ${SLOW_CANDIDATE_MS / 1000} s: squeal setup --slow ${c.path} runs it in the slow tier`,
    ),
    ...ignoredPathSuggestions(root),
  ];
  if (suggestions.length > 0) {
    io.stdout(
      `\nSuggestions; squeal warmup applies none:\n${suggestions.map((s) => `  ${s}\n`).join("")}`,
    );
  }
  return result.code;
}

/**
 * The warm-up: says how many test files the first run covers, starts the
 * daemon, requests a checkpoint and waits for its verdict, printing how many
 * files are done as it goes.
 */
export async function warmUp(root: AbsolutePath, io: CliIo): Promise<WarmupResult> {
  const { testFiles } = await readRepoFacts(root);
  const toRun = testFiles.paths.length - (testFiles.current ?? 0);
  io.stdout(
    testFiles.source === "store"
      ? `squeal warmup: the first run covers ${toRun} of ${plural(testFiles.paths.length, "test file")}, those without a current result\n`
      : `squeal warmup: the first run covers about ${plural(toRun, "test file")}, counted from the repository (no daemon has listed them yet)\n`,
  );
  let started = "";
  const startIo: CliIo = { ...io, stdout: (text) => (started += text) };
  if ((await startCommand([root], startIo)) !== 0) {
    io.stdout("No verdict: no daemon could be started for the warm-up; see above\n");
    io.stdout(verdictText(3));
    return { code: 3, slowCandidates: [] };
  }
  io.stdout(`${started.split("\n")[0]}\n`);
  const id = worktreeIdFor(root);
  let running = true;
  const progress = reportProgress(root, id, io, () => running);
  let code: number;
  try {
    code = await runCommand(runAllArgs(), io);
  } finally {
    running = false;
    await progress;
  }
  const verdict: 0 | 1 | 3 = code === 0 || code === 1 ? code : 3;
  io.stdout(verdictText(verdict));
  return {
    code: verdict,
    slowCandidates: verdict === 3 ? [] : slowCandidates(root, id),
  };
}

/**
 * The arguments of the warm-up's `run --all`. Seam for 001-307: its
 * checkpoint will also record the ignored paths each test file read.
 */
function runAllArgs(): string[] {
  return ["--all", "--wait"];
}

/**
 * D3: the ignored project paths each slow file read or spawned, as
 * suggestions for `squeal setup`. Seam for 001-307, which records them; until
 * it lands there are none to say.
 */
function ignoredPathSuggestions(_root: AbsolutePath): string[] {
  return [];
}

function verdictText(code: 0 | 1 | 3): string {
  switch (code) {
    case 0:
      return "\nsqueal warmup: every test file is current with no known failure. The results carry over to this repository's other worktrees where their inputs match.\n";
    case 1:
      return "\nsqueal warmup: every test file has a result, with the known failures above. The results carry over to this repository's other worktrees where their inputs match.\n";
    case 3:
      return "\nsqueal warmup: no verdict, so some test files may still lack a result; run squeal warmup again, or npx vitest run.\n";
  }
}

/** Prints `N of M test files done` from the open checkpoint each time N changes, until `running` is false. */
async function reportProgress(
  root: AbsolutePath,
  id: WorktreeId,
  io: CliIo,
  running: () => boolean,
): Promise<void> {
  let last = "";
  while (running()) {
    await new Promise((resolve) => setTimeout(resolve, PROGRESS_POLL_MS));
    if (!running()) return;
    const open = withStatusStore(root, {}, ({ store }) =>
      parseCheckpointProgress(store.meta.get(checkpointMetaKey(id))),
    );
    if (open === null || "available" in open) continue;
    const line = `${open.done} of ${plural(open.total, "test file")} done`;
    if (line === last) continue;
    last = line;
    io.stdout(`squeal warmup: ${line}\n`);
  }
}

/** 004 D1: fast test files whose last run took longer than `SLOW_CANDIDATE_MS`, slowest first. */
function slowCandidates(root: AbsolutePath, id: WorktreeId): SlowCandidate[] {
  const { policy } = loadPolicy(root);
  const isSlow = slowFiles(policy, policy.nodeTest);
  const found = withStatusStore(root, {}, ({ store }) => durations(store, id));
  if (!Array.isArray(found)) return [];
  return found
    .filter((f) => f.durationMs > SLOW_CANDIDATE_MS && !isSlow(f.ref))
    .map(({ ref, durationMs }) => ({ path: ref.path, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function durations(store: Store, id: WorktreeId) {
  return store.testFileKeys.list(id).flatMap((row) => {
    if (row.key === null) return [];
    // `usedAt` 0: reading a duration is not a lookup hit (spec 001 D8).
    const durationMs = durationOf(store.results.byKey(row.key, 0));
    return durationMs === null ? [] : [{ ref: row.testFile, durationMs }];
  });
}
