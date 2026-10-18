import { loadPolicy } from "../core/daemon/policy.js";
import { compare, findWorktreeRoot, worktreeIdFor } from "../core/fs/index.js";
import { testFileId } from "../core/keys/index.js";
import { durationOf } from "../core/scheduler/files.js";
import { slowFiles } from "../core/slow/classify.js";
import { readSlowActivity } from "../core/slow/state.js";
import { type IgnoredReads, readIgnoredReads, withStatusStore } from "../core/status/index.js";
import { plural } from "../core/text.js";
import {
  type AbsolutePath,
  checkpointMetaKey,
  parseCheckpointProgress,
  type Store,
  type TestFileRef,
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

/** A slow file's gitignored reads in the warm-up's checkpoint, capped as 001-307 stored them. */
export interface IgnoredRead {
  readonly path: string;
  /** Empty when the file was observed and read none. */
  readonly paths: readonly string[];
  /** How many more past the cap. */
  readonly more: number;
  /**
   * Set when `more` adds up several pools' overflow, which may name the same
   * paths, so it is an upper bound (reviews/wave-2.5.md S2).
   */
  readonly moreAtMost?: true;
}

/** What the warm-up's record holds of the slow files (spec 005 D3, 001-307). */
export interface SlowFileReads {
  readonly reads: readonly IgnoredRead[];
  /** Slow files the record does not hold: not observed, or read none; it does not tell them apart. */
  readonly unobserved: readonly string[];
}

export interface WarmupResult extends SlowFileReads {
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
    ...result.reads.filter((r) => r.paths.length > 0).map(ignoredReadText),
  ];
  if (suggestions.length > 0) {
    io.stdout(
      `\nSuggestions; squeal warmup applies none:\n${suggestions.map((s) => `  ${s}\n`).join("")}`,
    );
  }
  for (const note of ignoredReadNotes(result)) io.stdout(`squeal warmup: ${note}\n`);
  return result.code;
}

/**
 * The warm-up: says how many test files it re-runs, starts the
 * daemon, requests a checkpoint and waits for its verdict, printing how many
 * files are done as it goes.
 */
export async function warmUp(root: AbsolutePath, io: CliIo): Promise<WarmupResult> {
  const { testFiles } = await readRepoFacts(root);
  // 001-312: the observing checkpoint re-runs every file, current or not.
  io.stdout(
    testFiles.source === "store"
      ? `squeal warmup: runs all ${plural(testFiles.paths.length, "test file")}, current ones too, to record the ignored paths each reads\n`
      : `squeal warmup: runs about ${plural(testFiles.paths.length, "test file")}, counted from the repository (no daemon has listed them yet), to record the ignored paths each reads\n`,
  );
  let started = "";
  const startIo: CliIo = { ...io, stdout: (text) => (started += text) };
  if ((await startCommand([root], startIo)) !== 0) {
    io.stdout("No verdict: no daemon could be started for the warm-up; see above\n");
    io.stdout(verdictText(3));
    return { code: 3, slowCandidates: [], reads: [], unobserved: [] };
  }
  io.stdout(`${started.split("\n")[0]}\n`);
  const id = worktreeIdFor(root);
  let running = true;
  const progress = reportProgress(root, id, io, () => running);
  let code: number;
  try {
    code = await runCommand(["--all", "--wait"], io, { observeIgnored: true });
  } finally {
    running = false;
    await progress;
  }
  const verdict: 0 | 1 | 3 = code === 0 || code === 1 ? code : 3;
  io.stdout(verdictText(verdict));
  if (verdict === 3) return { code: verdict, slowCandidates: [], reads: [], unobserved: [] };
  const candidates = slowCandidates(root, id);
  return { code: verdict, slowCandidates: candidates, ...ignoredReads(root, id, candidates) };
}

/**
 * D3: a slow file's ignored reads, said to be unkeyed so they never read as
 * coverage. No declaration keys a gitignored path (004 D5 as amended
 * 2026-10-18, task 004-81), so a test of build output Squeal does not
 * produce is pointed at its runner's exclude instead of `--input`.
 */
export function ignoredReadText(read: IgnoredRead): string {
  const bound = read.moreAtMost === true && read.more > 0;
  const count = bound ? read.paths.length : read.paths.length + read.more;
  const more = read.more > 0 ? [`and ${bound ? "up to " : ""}${read.more} more`] : [];
  const listed = [...read.paths, ...more];
  return `${read.path} read ${bound ? "at least " : ""}${plural(count, "gitignored path")}, unkeyed: a change to ${count === 1 ? "it" : "them"} re-runs nothing, and no input declaration keys a gitignored path; a test of build output Squeal does not produce belongs in its runner's exclude (vitest.exclude, or its project's exclude), for you or CI to run${listed.map((p) => `\n    ${p}`).join("")}`;
}

/**
 * The slow files with no ignored read to suggest, so an unobserved file
 * never reads as one that read none.
 */
export function ignoredReadNotes({ reads, unobserved }: SlowFileReads): string[] {
  const clean = reads.filter((r) => r.paths.length === 0).map((r) => r.path);
  return [
    ...(clean.length === 0
      ? []
      : [`${clean.join(", ")} read no ignored path outside its declared inputs`]),
    ...(unobserved.length === 0
      ? []
      : [`no ignored read recorded for ${unobserved.join(", ")}: not observed by this warm-up`]),
  ];
}

/**
 * D3 and 001-307: the gitignored paths each slow file read in the warm-up's
 * checkpoint, slow by `slow.include` (`isSlow`) or as a slow candidate. A
 * file run in two Vitest pools is named once, with every pool's paths
 * (reviews/wave-2.5.md S2). `record` is `null` when no warm-up stored one.
 */
export function slowFileReads(
  record: IgnoredReads | null,
  files: readonly TestFileRef[],
  isSlow: (ref: TestFileRef) => boolean,
): SlowFileReads {
  const reads = new Map<string, IgnoredRead>();
  const unobserved = new Set<string>();
  for (const ref of files.filter(isSlow)) {
    const file = record?.files[testFileId(ref)];
    if (file === undefined) unobserved.add(ref.path);
    else reads.set(ref.path, merged(reads.get(ref.path), ref.path, file));
  }
  for (const path of reads.keys()) unobserved.delete(path);
  return {
    reads: [...reads.values()].sort((a, b) => compare(a.path, b.path)),
    unobserved: [...unobserved].sort(compare),
  };
}

/** One path's reads with another pool's added; their overflow counts only bound the rest. */
function merged(
  read: IgnoredRead | undefined,
  path: string,
  file: { readonly paths: readonly string[]; readonly more: number },
): IgnoredRead {
  if (read === undefined) return { path, paths: file.paths, more: file.more };
  const paths = [...new Set([...read.paths, ...file.paths])].sort(compare);
  const more = read.more + file.more;
  return more > 0 ? { path, paths, more, moreAtMost: true } : { path, paths, more };
}

function ignoredReads(
  root: AbsolutePath,
  id: WorktreeId,
  candidates: readonly SlowCandidate[],
): SlowFileReads {
  const { policy } = loadPolicy(root);
  const inTier = slowFiles(policy, policy.nodeTest);
  const longer = new Set(candidates.map((c) => c.path));
  const found = withStatusStore(root, {}, ({ store }) =>
    slowFileReads(
      readIgnoredReads(store, id),
      store.testFileKeys.list(id).map((row) => row.testFile),
      (ref) => inTier(ref) || longer.has(ref.path),
    ),
  );
  return "reads" in found ? found : { reads: [], unobserved: [] };
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

/**
 * Prints `N of M test files done` from the open checkpoint each time it
 * changes, until `running` is false, with the slow files the load guard
 * holds (004 D3) in the status line's words (`slow-text.ts`), so a busy
 * host's wait of up to `maxDeferMs` is named, not silent (005-39).
 */
async function reportProgress(
  root: AbsolutePath,
  id: WorktreeId,
  io: CliIo,
  running: () => boolean,
): Promise<void> {
  const { policy } = loadPolicy(root);
  const isSlow = slowFiles(policy, policy.nodeTest);
  let last = "";
  while (running()) {
    await new Promise((resolve) => setTimeout(resolve, PROGRESS_POLL_MS));
    if (!running()) return;
    const line = withStatusStore(root, {}, ({ store }) => {
      const open = parseCheckpointProgress(store.meta.get(checkpointMetaKey(id)));
      if (open === null) return null;
      const activity = readSlowActivity(store, id);
      const queued =
        activity?.kind === "waiting" && activity.for === "load"
          ? store.testFileKeys
              .list(id)
              .filter((row) => row.pending === "queued" && isSlow(row.testFile)).length
          : 0;
      return progressText(open.done, open.total, queued);
    });
    if (typeof line !== "string" || line === last) continue;
    last = line;
    io.stdout(`squeal warmup: ${line}\n`);
  }
}

/** `1 of 3 test files done; 2 slow test files waiting for host load to drop`. */
export function progressText(done: number, total: number, waitingForLoad: number): string {
  const line = `${done} of ${plural(total, "test file")} done`;
  return waitingForLoad === 0
    ? line
    : `${line}; ${plural(waitingForLoad, "slow test file")} waiting for host load to drop`;
}

/**
 * 004 D1: fast test files whose last run took longer than `SLOW_CANDIDATE_MS`, slowest first.
 * Read-only, so a daemon's writes never empty it (011-01).
 */
export function slowCandidates(root: AbsolutePath, id: WorktreeId): SlowCandidate[] {
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
    // `usedAt` 0: reading a duration is not a lookup hit (spec 001 D8) and takes no write lock.
    const durationMs = durationOf(store.results.byKey(row.key, 0));
    return durationMs === null ? [] : [{ ref: row.testFile, durationMs }];
  });
}
