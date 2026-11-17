import { existsSync } from "node:fs";
import { join } from "node:path";
import { withKeyer } from "../core/commit/at-keys-walk.js";
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
}

export interface NowSide {
  readonly source: NowSource;
  /** The test files the paths select now, by `testFileId`: listed now, or named and not listed. */
  readonly refs: readonly TestFileRef[];
  /** Whether a file is among those listed now: for a path that selects none, the commit side decides. */
  readonly listed: ReadonlySet<string>;
  readonly state: (ref: TestFileRef) => SideState;
}

/** The current side of `input.paths`'s test files. */
export async function nowSide(input: NowInput): Promise<NowSide> {
  const row = input.main?.worktrees.get(input.worktreeId) ?? null;
  if (input.main !== null && worktreeLiveness(row, input.now).state === "alive") {
    return daemonSide(input, input.main);
  }
  return keyedSide(input);
}

/** D3: the daemon's keys and the results at them; no re-keying. */
function daemonSide(input: NowInput, main: Store): NowSide {
  const rows = main.testFileKeys.list(input.worktreeId);
  const byId = new Map(rows.map((r) => [testFileId(r.testFile), r]));
  const { refs, listed } = select(
    rows.map((r) => r.testFile),
    input.paths,
  );
  const revision = rows.reduce<number | null>((n, r) => Math.max(n ?? 0, r.revision), null);
  // Read now: the store closes when this side is returned.
  const states = new Map<string, SideState>();
  for (const ref of refs) {
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
  return { source: { kind: "daemon", revision }, refs, listed, state };
}

/** D3 with no daemon: the gate's keyer in the working tree, and the results at its keys. */
async function keyedSide(input: NowInput): Promise<NowSide> {
  const { root, commonDir, main } = input;
  const options = { adapters: input.adapters, squealVersion: input.squealVersion, env: input.env };
  return withKeyer(root, commonDir, main ?? undefined, options, async ({ keyer, listed: all }) => {
    const { refs, listed } = select([...all.values()], input.paths);
    const keyed = await keyer.keyed(refs.filter((ref) => listed.has(testFileId(ref))));
    const states = new Map<string, SideState>();
    for (const ref of refs) {
      const at = keyed.get(ref);
      const id = testFileId(ref);
      if (!listed.has(id)) states.set(id, unlisted(root, ref, "no runner lists it"));
      else if (at === undefined)
        states.set(id, { state: "not determined", reason: "no runner keyed it" });
      else
        states.set(
          id,
          stateOf(at.key, main === null ? [] : resultsAt(main, ref, at.key), input.worktreeId),
        );
    }
    const state = (ref: TestFileRef) =>
      states.get(testFileId(ref)) ?? unlisted(root, ref, "no runner lists it");
    return { source: { kind: "stored" }, refs, listed, state };
  });
}

function resultsAt(main: Store, ref: TestFileRef, key: string) {
  return main.results
    .byKey(key, 0)
    .filter((r) => r.check.project === ref.project && r.check.testPath === ref.path);
}

/** A named file not listed now: absent when the working tree lacks it. */
function unlisted(root: AbsolutePath, ref: TestFileRef, why: string): SideState {
  if (!existsSync(join(root, ref.path))) return { state: "absent" };
  return { state: "not determined", reason: why };
}

/**
 * The listed files each path selects (the file, or every file below a
 * folder), and each path that selects none as a file of its own in the
 * default project: the commit may list it.
 */
export function select(
  all: readonly TestFileRef[],
  paths: readonly RelativePath[] | null,
): { refs: TestFileRef[]; listed: Set<string> } {
  const listed = new Set(all.map(testFileId));
  if (paths === null) return { refs: [...all], listed };
  const refs = new Map<string, TestFileRef>();
  for (const path of paths) {
    const under = path === "" ? "" : `${path.replace(/\/+$/, "")}/`;
    const hits = all.filter((ref) => ref.path === path || ref.path.startsWith(under));
    if (hits.length === 0) refs.set(testFileId({ project: "", path }), { project: "", path });
    for (const ref of hits) refs.set(testFileId(ref), ref);
  }
  return { refs: [...refs.values()], listed };
}
