import { existsSync } from "node:fs";
import { join } from "node:path";
import { resultsAt } from "../core/commit/at-keys-checkout.js";
import { withKeyer } from "../core/commit/at-keys-walk.js";
import { closureFor } from "../core/delivery/closure.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { worktreeLiveness } from "../core/presence/heartbeat.js";
import type { AbsolutePath, EpochMs, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import type { Store } from "../core/types/store.js";
import { type NowSource, type SideState, stateOf } from "./status-at-report.js";

/*
 * Spec 023 D3 (row 023-06): the current side. With a live daemon in this
 * worktree, its keys (`test_file_keys`) and the results at them, with no
 * keying here; with none, the gate's keyer in the working tree (row
 * 020-51's `openKeyer`, through `withKeyer`, policy as a daemon reads it)
 * and the store's results at its keys, read-only, as 020 D11.7 reads them.
 */

export interface NowInput {
  readonly root: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly worktreeId: WorktreeId;
  /** The main store, read-only; `null` when it cannot be read. */
  readonly main: Store | null;
  /** The paths that narrow the test files, relative to the root; `null` for every file. */
  readonly paths: readonly RelativePath[] | null;
  readonly now: EpochMs;
  readonly adapters: (
    root: AbsolutePath,
    policy: Policy,
    tempDir: AbsolutePath,
  ) => Promise<readonly RunnerAdapter[]>;
  readonly squealVersion: string;
  readonly env: NodeJS.ProcessEnv;
  /** Row 023-08: key in the working tree even with a live daemon (its closure was not trusted). */
  readonly keyed?: boolean;
}

export interface NowSide {
  readonly source: NowSource;
  /** The test files listed now that the paths select. */
  readonly refs: readonly TestFileRef[];
  readonly state: (ref: TestFileRef) => SideState;
  /**
   * Row 023-08: the paths `ref`'s closure loads now: the daemon's stored
   * closure when it is this worktree's, the keyer's walk without a daemon;
   * `undefined` when neither gives one.
   */
  readonly loads: (ref: TestFileRef) => readonly RelativePath[] | undefined;
}

/** The current side of `input.paths`'s test files. */
export async function nowSide(input: NowInput): Promise<NowSide> {
  const row = input.main?.worktrees.get(input.worktreeId) ?? null;
  if (
    input.keyed !== true &&
    input.main !== null &&
    worktreeLiveness(row, input.now).state === "alive"
  ) {
    return daemonSide(input, input.main);
  }
  return keyedSide(input);
}

/** D3: the daemon's keys and the results at them; no re-keying. */
function daemonSide(input: NowInput, main: Store): NowSide {
  const rows = main.testFileKeys.list(input.worktreeId);
  const byId = new Map(rows.map((r) => [testFileId(r.testFile), r]));
  const refs = select(
    rows.map((r) => r.testFile),
    input.paths,
  );
  const revision = rows.reduce<number | null>((n, r) => Math.max(n ?? 0, r.revision), null);
  // Read now: the store closes when this side is returned.
  const states = new Map<string, SideState>();
  const closures = new Map<string, readonly RelativePath[] | undefined>();
  const closureOf = closureFor(main, input.worktreeId);
  for (const ref of refs) {
    closures.set(testFileId(ref), closureOf(ref));
    const row = byId.get(testFileId(ref));
    if (row === undefined) continue;
    if (row.key === null) {
      states.set(testFileId(ref), {
        state: "not determined",
        reason: "the daemon has no key for it",
      });
      continue;
    }
    const side = stateOf(row.key, resultsAt(main, ref, row.key), input.worktreeId);
    const pending = side.state === "no result" && row.pending !== null;
    states.set(testFileId(ref), pending ? { ...side, pending: row.pending ?? undefined } : side);
  }
  const state = (ref: TestFileRef) =>
    states.get(testFileId(ref)) ?? unlisted(input.root, ref, "the daemon lists no such test file");
  const loads = (ref: TestFileRef) => closures.get(testFileId(ref));
  return { source: { kind: "daemon", revision }, refs, state, loads };
}

/** D3 with no daemon: the gate's keyer in the working tree, and the results at its keys. */
async function keyedSide(input: NowInput): Promise<NowSide> {
  const { root, commonDir, main } = input;
  const options = { adapters: input.adapters, squealVersion: input.squealVersion, env: input.env };
  return withKeyer(root, commonDir, main ?? undefined, options, async ({ keyer, listed: all }) => {
    const refs = select([...all.values()], input.paths);
    const keyed = await keyer.keyed(refs);
    const states = new Map<string, SideState>();
    const closures = new Map<string, readonly RelativePath[]>();
    for (const ref of refs) {
      const at = keyed.get(ref);
      const id = testFileId(ref);
      if (at !== undefined) closures.set(id, at.loads);
      if (at === undefined)
        states.set(id, { state: "not determined", reason: "no runner keyed it" });
      else
        states.set(
          id,
          stateOf(at.key, main === null ? [] : resultsAt(main, ref, at.key), input.worktreeId),
        );
    }
    const state = (ref: TestFileRef) =>
      states.get(testFileId(ref)) ?? unlisted(root, ref, "no runner lists it");
    const loads = (ref: TestFileRef) => closures.get(testFileId(ref));
    return { source: { kind: "stored" }, refs, state, loads };
  });
}

/** A named file not listed now: absent when the working tree lacks it. */
function unlisted(root: AbsolutePath, ref: TestFileRef, why: string): SideState {
  if (!existsSync(join(root, ref.path))) return { state: "absent" };
  return { state: "not determined", reason: why };
}

/** Whether `paths` select `path`: the file itself, or a file below a named folder. */
export function selects(paths: readonly RelativePath[], path: RelativePath): boolean {
  return paths.some((p) => p === "" || p === path || path.startsWith(`${p.replace(/\/+$/, "")}/`));
}

/**
 * The listed files the paths select (each file, or every file below a
 * folder). A path that selects none now is the commit side's to answer.
 */
export function select(
  all: readonly TestFileRef[],
  paths: readonly RelativePath[] | null,
): TestFileRef[] {
  return paths === null ? [...all] : all.filter((ref) => selects(paths, ref.path));
}
