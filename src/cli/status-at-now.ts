import { existsSync } from "node:fs";
import { join } from "node:path";
import { resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { selects } from "../core/commit/at-keys-narrow.js";
import { withKeyer } from "../core/commit/at-keys-walk.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { worktreeLiveness } from "../core/presence/heartbeat.js";
import type { AbsolutePath, EpochMs, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import type { Store } from "../core/types/store.js";
import type { TestFileKeyRecord } from "../core/types/store-records.js";
import { type NowSource, type SideState, stateOf } from "./status-at-report.js";
import { StoredClosures, storedReaders } from "./stored-closures.js";

/*
 * Spec 023 D3 (row 023-06): the current side. With a live daemon in this
 * worktree, its keys (`test_file_keys`) and the results at them, with no
 * keying here; with none, the gate's keyer in the working tree (row
 * 020-51's `openKeyer`, through `withKeyer`, policy as a daemon reads it)
 * and the store's results at its keys, read-only, as 020 D11.7 reads them.
 * Row 023-19 (P5): a live daemon that has listed no test file yet is read
 * as no daemon is; the files a listing daemon does not list yet that the
 * working tree holds are keyed here (`listLate`). P4: a path that selects
 * no listed test file is a source path, and selects the test files whose
 * closure holds it, as `squeal status <path>` does: the daemon's stored
 * closures, or the closures the keying here gives.
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
  /** The test files listed now that the paths select, by path or (P4) by closure. */
  readonly refs: readonly TestFileRef[];
  readonly state: (ref: TestFileRef) => SideState;
  /** P4: the paths that select no listed test file, each with the files whose closure holds it. */
  readonly sources: ReadonlyMap<RelativePath, readonly TestFileRef[]>;
  /**
   * P5: whether this side has no state for `ref` that a keying here could
   * give: the daemon does not list it, or (no daemon) it is listed and was
   * not keyed (review wave-13 B4). `listLate` keys those.
   */
  readonly unlisted: (ref: TestFileRef) => boolean;
}

/** The current side of `input.paths`'s test files. */
export async function nowSide(input: NowInput): Promise<NowSide> {
  const row = input.main?.worktrees.get(input.worktreeId) ?? null;
  if (input.main !== null && worktreeLiveness(row, input.now).state === "alive") {
    const rows = input.main.testFileKeys.list(input.worktreeId);
    // P5: a starting daemon has listed nothing yet; "lists no such test file" would be wrong.
    if (rows.length > 0) return daemonSide(input, input.main, rows);
    return keyedSide(input, { why: "listing" });
  }
  return keyedSide(input);
}

/** D3: the daemon's keys and the results at them; no re-keying. */
function daemonSide(input: NowInput, main: Store, rows: readonly TestFileKeyRecord[]): NowSide {
  const byId = new Map(rows.map((r) => [testFileId(r.testFile), r]));
  const listed = rows.map((r) => r.testFile);
  const sources = new Map<RelativePath, readonly TestFileRef[]>();
  const named = sourcePaths(input.root, listed, input.paths);
  if (named.length > 0) {
    const closures = new StoredClosures().read(main);
    for (const path of named) {
      const readers = storedReaders(main, input.worktreeId, rows, closures, path);
      sources.set(
        path,
        readers.map((r) => r.testFile),
      );
    }
  }
  const refs = union(select(listed, input.paths), sources);
  const revision = rows.reduce<number | null>((n, r) => Math.max(n ?? 0, r.revision), null);
  // Review wave-13 B4: a path that selects no listed file by path may select, at the commit, a
  // file the daemon lists outside this side's selection; each listed file's state is read then.
  const bySource = (input.paths ?? []).some(
    (path) => !listed.some((ref) => selects([path], ref.path)),
  );
  // Read now: the store closes when this side is returned.
  const states = new Map<string, SideState>();
  for (const ref of bySource ? listed : refs) {
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
  return {
    source: { kind: "daemon", revision },
    refs,
    state,
    sources,
    unlisted: (ref) => !states.has(testFileId(ref)),
  };
}

/**
 * D3 with no daemon: the gate's keyer in the working tree, and the results
 * at its keys. `why` `listing`: a daemon runs and has listed nothing yet.
 * `sources` `false`: the paths are test files only, never source paths.
 */
async function keyedSide(
  input: NowInput,
  how: { readonly why?: "listing"; readonly sources?: false } = {},
): Promise<NowSide> {
  const { why } = how;
  const { root, commonDir, main } = input;
  const options = { adapters: input.adapters, squealVersion: input.squealVersion, env: input.env };
  return withKeyer(root, commonDir, main ?? undefined, options, async ({ keyer, listed }) => {
    const all = [...listed.values()];
    const named = how.sources === false ? [] : sourcePaths(root, all, input.paths);
    // P4: a source path's readers are known only from closures: every listed file is keyed.
    const asked = named.length > 0 ? all : select(all, input.paths);
    const keyed = await keyer.keyed(asked);
    const sources = new Map<RelativePath, readonly TestFileRef[]>();
    for (const path of named) {
      sources.set(
        path,
        asked.filter((ref) => keyed.get(ref)?.loads.includes(path) === true),
      );
    }
    const refs = union(select(all, input.paths), sources);
    const states = new Map<string, SideState>();
    // Review wave-13 B4: every keyed file's state, not only this side's selection: the commit's
    // closure may select a file whose closure here no longer holds the path.
    for (const ref of asked) {
      const at = keyed.get(ref);
      const id = testFileId(ref);
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
    const source: NowSource = why === undefined ? { kind: "stored" } : { kind: "stored", why };
    // A file listed here and not keyed is keyed by `listLate` when the other side asks for it.
    const unkeyed = (ref: TestFileRef) =>
      listed.has(testFileId(ref)) && !states.has(testFileId(ref));
    return { source, refs, state, sources, unlisted: unkeyed };
  });
}

/**
 * P5: the files of `refs` the daemon does not list that the working tree
 * holds, keyed here and read at those keys (D3's rule with no daemon);
 * the others as the daemon gives them. Review wave-13 B4: with no daemon,
 * the files listed here that this side did not key (the commit's closure
 * selected them), keyed the same way. `now` itself when there is none.
 */
export async function listLate(
  input: Omit<NowInput, "main" | "paths">,
  now: NowSide,
  refs: readonly TestFileRef[],
): Promise<NowSide> {
  const late = refs.filter((ref) => now.unlisted(ref) && existsSync(join(input.root, ref.path)));
  if (late.length === 0) return now;
  const paths = [...new Set(late.map((ref) => ref.path))];
  const keyed = await withStores(input.commonDir, (main) =>
    keyedSide({ ...input, main, paths }, { sources: false }),
  );
  const ids = new Set(late.map(testFileId));
  return {
    ...now,
    source: now.source.kind === "daemon" ? { ...now.source, late: late.length } : now.source,
    state: (ref) => (ids.has(testFileId(ref)) ? keyed.state(ref) : now.state(ref)),
  };
}

/** A named file not listed now: absent when the working tree lacks it. */
function unlisted(root: AbsolutePath, ref: TestFileRef, why: string): SideState {
  if (!existsSync(join(root, ref.path))) return { state: "absent" };
  return { state: "not determined", reason: why };
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

/**
 * P4: the paths the working tree holds that select no listed test file:
 * source paths, or paths that select nothing. A path it lacks is in no
 * closure now, and keys nothing more.
 */
export function sourcePaths(
  root: AbsolutePath,
  listed: readonly TestFileRef[],
  paths: readonly RelativePath[] | null,
): RelativePath[] {
  return (paths ?? []).filter(
    (path) => existsSync(join(root, path)) && !listed.some((ref) => selects([path], ref.path)),
  );
}

/** The files the paths select, and those the source paths select, once each. */
function union(
  selected: readonly TestFileRef[],
  sources: ReadonlyMap<RelativePath, readonly TestFileRef[]>,
): TestFileRef[] {
  const all = new Map(selected.map((ref) => [testFileId(ref), ref]));
  for (const refs of sources.values()) for (const ref of refs) all.set(testFileId(ref), ref);
  return [...all.values()];
}
