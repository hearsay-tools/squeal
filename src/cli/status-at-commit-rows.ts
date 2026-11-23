import { resultsAt } from "../core/commit/at-keys-checkout.js";
import { selects } from "../core/commit/at-keys-narrow.js";
import { changedText } from "../core/commit/at-keys-walk.js";
import { committedBlobs } from "../core/commit/tree.js";
import { runGit } from "../core/fs/git.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Store } from "../core/types/store.js";
import { idOf, reasonOf } from "./status-at-after.js";
import type { CommitSide } from "./status-at-commit.js";
import type { CommitAsked } from "./status-at-commit-ask.js";
import { type SideState, stateOf } from "./status-at-report.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c): the commit side of a
 * `status --at --run` (or `--wait`) call, read from its commit daemon,
 * with no keying in the call. The files are the ones the daemon lists at
 * the commit that the call's paths select (and, for a named path that is
 * no test file, the files that read it there); each is read at its live
 * key, the daemon's row in the shared store, so a file whose run observed
 * new inputs reads at its completed key (review wave-23 B3, without a
 * second keying). A result the commit daemon stored reads origin
 * `commit`. While the daemon still installs or starts, a file has no key
 * yet: `no result (setting up)`. A failed setup reads `not run` with its
 * text (R3). With `--run`, a file with no result the change did not
 * select reads so (R8).
 */

export interface RowsInput {
  /** The user's worktree: git reads the commit there. */
  readonly root: AbsolutePath;
  readonly commit: string;
  /** The call's paths, relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
  /** The caller's worktree, for the origin of its own results. */
  readonly own: WorktreeId;
  readonly asked: CommitAsked;
  /**
   * `--run`, or (row 023-61, W5) `--wait` alone with a kept wide ask of
   * the call's own change (`joinSelects`): a file with no result that no
   * queued ask holds was not selected by the change.
   */
  readonly selection: boolean;
}

/**
 * Row 023-61 (W5): whether `--wait` alone knows the change's selection: a
 * kept ask of the call's own change (`change`) named no path, so its files
 * are every file the change selects with no result at the commit. An ask
 * narrowed by paths, another caller's change, or a daemon that does not
 * tell what an ask named proves nothing.
 */
export function joinSelects(asked: CommitAsked): boolean {
  const { change } = asked;
  if (change === null) return false;
  return asked.asks.some(
    (ask) => ask.phase === "queued" && ask.change === change && ask.named?.length === 0,
  );
}

/** The commit side as its daemon keys it now, or as it stands while the daemon sets up. */
export async function rowsSide(
  main: Store | null,
  input: RowsInput,
): Promise<{ readonly at: CommitSide; readonly state: (ref: TestFileRef) => SideState }> {
  const { asked, paths } = input;
  const tree = asked.root;
  const rows = main === null || tree === null ? [] : main.testFileKeys.list(idOf(tree));
  const byId = new Map(rows.map((row) => [testFileId(row.testFile), row]));
  const sources = new Map<RelativePath, TestFileRef[]>();
  const add = (path: RelativePath, refs: readonly TestFileRef[]) =>
    sources.set(path, [
      ...new Map([...(sources.get(path) ?? []), ...refs].map((r) => [testFileId(r), r])).values(),
    ]);
  for (const ask of asked.asks)
    for (const [path, refs] of Object.entries(ask.readers)) add(path as RelativePath, refs);
  // Review 0.1.599 B2: `--wait` alone, the readers of its paths the commit daemon told.
  for (const [path, refs] of asked.readers ?? []) add(path, refs);
  const read = new Set([...sources.values()].flat().map(testFileId));
  const refs = rows
    .map((row) => row.testFile)
    .filter((ref) => paths === null || selects(paths, ref.path) || read.has(testFileId(ref)));
  const committed = await committedBlobs(input.root, input.commit);
  const why = main === null ? () => null : reasonOf(main, asked);
  const treeId = tree === null ? null : idOf(tree);
  const queued = new Set(asked.files.map(testFileId));
  const chose = input.selection && asked.asks.some((a) => a.phase === "queued");
  // Row 023-40c (row 023-07's whole-checkout check): a tree that is not the commit's runs nothing.
  const changed = asked.setup?.phase === "changed" ? asked.setup : null;
  // D4.9: the files the commit daemon would not run, their closure reading a path git does not hold.
  const refused = new Map(
    asked.asks.flatMap((ask) => ask.refused ?? []).map((r) => [testFileId(r.ref), r.reason]),
  );
  // Row 023-35 (T2): a node:test project tells its incomplete static closures; Vitest tells none.
  const closureOf = (ref: TestFileRef): "complete" | "incomplete" | "unchecked" => {
    const list = asked.incomplete?.[ref.project];
    if (list === undefined) return "unchecked";
    return list.includes(ref.path) ? "incomplete" : "complete";
  };
  // Row 023-73 (Y3): the test files that differ between the commit and the working tree.
  const differs = await differsAt(input.root, input.commit);
  const marked = (ref: TestFileRef, side: SideState): SideState =>
    (side.state === "pass" || side.state === "fail") && differs.has(ref.path)
      ? { ...side, changedSince: true }
      : side;
  const state = (ref: TestFileRef): SideState => marked(ref, stateAt(ref));
  const stateAt = (ref: TestFileRef): SideState => {
    if (changed !== null) return { state: "not comparable", reason: changedText(changed) };
    const no = refused.get(testFileId(ref));
    if (no !== undefined) return { state: "not comparable", reason: no };
    const row = byId.get(testFileId(ref));
    if (row === undefined) return unlisted(asked, committed.has(ref.path), input.commit);
    if (row.key === null)
      return { state: "not determined", reason: "its commit daemon could not key it" };
    const now = stateOf(row.key, main === null ? [] : resultsAt(main, ref, row.key), input.own);
    if ("origin" in now && now.origin.worktreeId === treeId)
      return { ...now, origin: { ...now.origin, kind: "commit" } };
    if (now.state !== "no result") return now;
    const reason = why(ref, row.key);
    if (reason !== null) return reason;
    if (row.pending !== null && row.pending !== undefined)
      return { state: "no result", key: row.key, pending: row.pending };
    if (chose && !queued.has(testFileId(ref)))
      return { state: "no result", key: row.key, notSelected: true, closure: closureOf(ref) };
    return now;
  };
  const at: CommitSide = {
    refs,
    state,
    checkoutMs: null,
    inputCheckMs: null,
    changed: changed === null ? null : { path: changed.path, by: changed.by },
    failure: null,
    sources,
  };
  return { at, state };
}

/**
 * Row 023-73 (Y3): the tracked paths whose working-tree content differs
 * from `commit`'s, staged or not; none when git cannot tell, so no line
 * claims a version it did not check.
 */
async function differsAt(root: AbsolutePath, commit: string): Promise<ReadonlySet<RelativePath>> {
  const out = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", commit, "--"]).catch(
    () => "",
  );
  return new Set(out.split("\0").filter((path) => path !== "") as RelativePath[]);
}

/** A file the commit daemon does not list: setting up, its setup failed, absent at the commit, or unknown. */
function unlisted(asked: CommitAsked, inCommit: boolean, commit: string): SideState {
  const at = commit.slice(0, 9);
  const { setup } = asked;
  if (setup === null)
    return {
      state: "not determined",
      reason: asked.problems[0] ?? `no commit daemon serves ${at}`,
    };
  if (setup.phase === "failed") return { state: "not run", reason: "setup", setup: setup.text };
  if (setup.phase !== "ready") return { state: "no result", key: "", pending: "setting up" };
  if (!inCommit) return { state: "absent" };
  return { state: "not determined", reason: `its commit daemon lists no such test file at ${at}` };
}
