import { describe, expect, it } from "vitest";
import { printNamed } from "../../src/cli/named-print.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { selectionPartial } from "../../src/cli/verdict.js";
import { namedSnapshot } from "../../src/cli/wait/snapshot.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import type { RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import { B, C, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-401 (gh-242): while a selection's list may be incomplete, the
 * runner not having listed the revision (`unlisted`) or the daemon's pass
 * not stored at the read's revision (`unsynced`), the text gives its counts
 * as lower bounds and the JSON says `selection.complete: false`.
 */
const SOURCE = "src/b.ts" as RelativePath;

/** B and C current at revision 4; with `unlisted`, revision 5 stored and not listed. */
function repo(unlisted: boolean) {
  const made = repoWith([], [B, C]);
  const { store } = made;
  const id = made.repo.mainId;
  if (unlisted) {
    store.revisions.append({
      worktreeId: id,
      createdAt: NOW - 10_000,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "src/other.ts", oldHash: "a", newHash: "b" }],
    });
  }
  recordRefinedApplied(store, id, 4);
  return made.repo.main;
}

/** A daemon whose pass is stored at `revision`, naming B as `SOURCE`'s one reader. */
const syncAt = (revision: number) => (): DaemonSync => ({
  current: (): SyncState => ({
    state: "synced",
    revision: revision as RevisionNumber,
    incarnation: null,
    readers: new Map([[SOURCE, [ref(B)]]]),
  }),
  stop: () => {},
});

const wait = (root: string, paths: readonly string[], sync: () => DaemonSync) =>
  waitForNamed(root as never, paths, {
    timeoutMs: 200,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync,
    ask: async () => [],
  });

/** `printNamed --json`'s `selection` payload and its stderr lines. */
async function json(read: ReturnType<typeof wait>) {
  let out = "";
  let err = "";
  const io = { stdout: (t: string) => (out += t), stderr: (t: string) => (err += t), env: {} };
  await printNamed(read, { json: true }, io, () => NOW);
  return { selection: JSON.parse(out).selection, err };
}

const PARTIAL = (target: string) =>
  `Selection: at least 1 test file; the list is partial while Squeal catches up with ${target}\n`;

describe("a partial selection says it is partial (row 011-401)", () => {
  it("unlisted: lower bounds in the text, complete false in the JSON", async () => {
    const root = repo(true);

    const got = await wait(root, [SOURCE], syncAt(5));
    if (got.outcome === "unavailable") throw new Error("unavailable");
    const text = namedText(got, NOW);
    const { selection, err } = await json(Promise.resolve(got));

    expect(got.selection.partial).toEqual({ revision: 5 });
    expect(text).toContain(PARTIAL("revision 5"));
    expect(text).toContain(`Not a listed test file: ${SOURCE}; it selects at least 1 test file`);
    expect(selection.complete).toBe(false);
    expect(err).toContain(PARTIAL("revision 5"));
  });

  it("unsynced: the revision the daemon's pass stored, which the read has not reached", async () => {
    const root = repo(false);

    const got = await wait(root, [SOURCE], syncAt(6));
    if (got.outcome === "unavailable") throw new Error("unavailable");

    expect(got.selection.partial).toEqual({ revision: 6 });
    expect(namedText(got, NOW)).toContain(PARTIAL("revision 6"));
    expect((await json(Promise.resolve(got))).selection.complete).toBe(false);
  });

  it("unsynced snapshot with a pass not stored: the latest edits", async () => {
    const root = repo(false);
    const pending = (): DaemonSync => ({ current: () => ({ state: "pending" }), stop: () => {} });

    const got = await namedSnapshot(root, [SOURCE], { now: () => NOW, settleMs: 0, sync: pending });
    if (got.outcome === "unavailable") throw new Error("unavailable");

    // Its readers come from stored closures, which hold none of B yet.
    expect(got.selection.partial).toEqual({ revision: null });
    expect(namedText(got, NOW)).toContain(
      "Selection: no test file yet; the list is partial while Squeal catches up with your latest edits\n",
    );
  });

  it("complete: a source path at a listed, synced revision, and test files during a listing", async () => {
    const synced = await wait(repo(false), [SOURCE], syncAt(4));
    const named = await wait(repo(true), [B, C], syncAt(5));
    if (synced.outcome === "unavailable" || named.outcome === "unavailable") {
      throw new Error("unavailable");
    }

    for (const got of [synced, named]) {
      expect(got.selection.partial).toBeUndefined();
      expect(namedText(got, NOW)).not.toContain("the list is partial");
      expect((await json(Promise.resolve(got))).selection.complete).toBe(true);
    }
    expect(namedText(synced, NOW)).toContain(
      `Not a listed test file: ${SOURCE}; it selects the 1 test file that reads it`,
    );
  });
});

describe("selectionPartial (row 011-401)", () => {
  const classes = (revision: number, unlisted: boolean) => ({
    revision: revision as RevisionNumber,
    testFiles: 1,
    byClass: { current: 1, pending: 0, stale: 0, unknown: 0 },
    unlisted,
  });
  const synced = (revision: number): SyncState => ({
    state: "synced",
    revision: revision as RevisionNumber,
    incarnation: null,
  });
  const source = [{ kind: "source" as const }];

  it("is null for a fixed selection, else names the revision it catches up with", () => {
    const fixed = [{ kind: "test-file" as const }];
    expect(selectionPartial({ paths: fixed, verdict: classes(5, true), sync: synced(6) })).toBe(
      null,
    );
    expect(selectionPartial({ paths: source, verdict: classes(5, true), sync: synced(5) })).toEqual(
      { revision: 5 },
    );
    expect(
      selectionPartial({ paths: source, verdict: classes(5, false), sync: synced(6) }),
    ).toEqual({ revision: 6 });
    expect(selectionPartial({ paths: source, verdict: classes(5, false), sync: synced(5) })).toBe(
      null,
    );
  });

  it("a daemon that cannot sync: a wait counts it as reached, a snapshot does not", () => {
    const unsupported: SyncState = { state: "unsupported" };
    const read = { paths: source, verdict: classes(5, false), sync: unsupported };
    expect(selectionPartial(read)).toBe(null);
    expect(selectionPartial({ ...read, snapshot: true })).toEqual({ revision: null });
  });
});
