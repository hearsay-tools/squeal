import { describe, expect, it } from "vitest";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { fixedSelection } from "../../src/cli/verdict.js";
import { namedSnapshot } from "../../src/cli/wait/snapshot.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import type { RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import { check } from "../status/helpers.js";
import { A, B, C, fail, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-398 (gh-232, spec 005 D2): a named wait or snapshot whose named
 * test files are all current gives their verdict while the runner has not
 * listed the worktree's revision. A named path that is not a listed test
 * file, here a source path, keeps exit 3 with the listing named, since the
 * listing may change what it selects.
 */
const SOURCE = "src/b.ts" as RelativePath;
/** The verdict line names the listing that holds a source path's selection. */
const LISTING = /revision 5 is not listed yet \(.*\), so this result may not cover it/;

type Change = { path: string; oldHash: string | null; newHash: string | null };
/** An unrelated content edit: it changes no closure the listing would re-resolve. */
const UNRELATED: Change = { path: "src/other.ts", oldHash: "a", newHash: "b" };

/** B and C current at revision 4, A queued; revision 5, of `changes`, is stored and not listed. */
function unlistedRepo(changes: readonly Change[] = [UNRELATED]) {
  const { repo, store } = repoWith([A], [B, C]);
  store.revisions.append({
    worktreeId: repo.mainId,
    createdAt: NOW - 10_000,
    head: null,
    dirty: false,
    trigger: "watch",
    changes: changes as never,
  });
  recordRefinedApplied(store, repo.mainId, 4);
  return { repo, store };
}

/** A daemon whose pass is stored at revision 5, naming B as `SOURCE`'s one reader. */
const synced = (): SyncState => ({
  state: "synced",
  revision: 5 as RevisionNumber,
  incarnation: null,
  readers: new Map([[SOURCE, [ref(B)]]]),
});
const sync = (): DaemonSync => ({ current: synced, stop: () => {} });

const wait = (root: string, paths: readonly string[]) =>
  waitForNamed(root as never, paths, {
    timeoutMs: 200,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync,
    ask: async () => [],
  });

describe("a named wait during an unlisted revision judges its named files (row 011-398)", () => {
  it("exits 0 for named current passing test files", async () => {
    const { repo } = unlistedRepo();

    const got = await wait(repo.main, [B, C]);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("settled");
    expect(got.verdict.unlisted).toBe(false);
    expect(namedCode(got)).toBe(0);
    expect(namedText(got, NOW)).not.toMatch(LISTING);
  });

  it("exits 1 for a named current file with a known failure", async () => {
    const { repo, store } = unlistedRepo();
    fail(store, repo.mainId, check(C, "holds"));

    const got = await wait(repo.main, [B, C]);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(namedCode(got)).toBe(1);
  });

  it("exits 3 with the listing named for a named source path", async () => {
    const { repo } = unlistedRepo();

    const got = await wait(repo.main, [SOURCE]);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.selection.paths.map((p) => p.kind)).toEqual(["source"]);
    expect(got.verdict.unlisted).toBe(true);
    expect(namedCode(got)).toBe(3);
    expect(namedText(got, NOW)).toMatch(LISTING);
  });

  it("a snapshot of named current test files exits 0, of a source path 3", async () => {
    const { repo } = unlistedRepo();
    const options = { now: () => NOW, settleMs: 0, sync };

    const files = await namedSnapshot(repo.main, [B, C], options);
    const source = await namedSnapshot(repo.main, [SOURCE], options);

    if (files.outcome === "unavailable" || source.outcome === "unavailable") {
      throw new Error("unavailable");
    }
    expect(namedCode(files)).toBe(0);
    expect(namedCode(source)).toBe(3);
    expect(namedText(source, NOW)).toMatch(LISTING);
  });
});

describe("a pending revision that may change a named closure keeps the listing hold (review 0.1.567 B1)", () => {
  const changes: [string, Change[]][] = [
    ["adds a path", [{ path: "src/choice.ts", oldHash: null, newHash: "n" }]],
    ["deletes a path", [UNRELATED, { path: "src/choice.ts", oldHash: "o", newHash: null }]],
    ["changes a package.json", [{ path: "pkg/package.json", oldHash: "a", newHash: "b" }]],
  ];

  it.each(changes)("exits 3 with the listing named when it %s", async (_, pending) => {
    const { repo } = unlistedRepo(pending);

    const got = await wait(repo.main, [B, C]);
    const snapshot = await namedSnapshot(repo.main, [B, C], { now: () => NOW, settleMs: 0, sync });

    if (got.outcome === "unavailable" || snapshot.outcome === "unavailable") {
      throw new Error("unavailable");
    }
    for (const read of [got, snapshot]) {
      expect(read.verdict.unlisted).toBe(true);
      expect(namedCode(read)).toBe(3);
      expect(namedText(read, NOW)).toMatch(/revision 5 is not listed yet/);
    }
  });

  it("exits 3 when a named file's key row was written by the pending revision", async () => {
    const { repo, store } = unlistedRepo();
    // The content pass re-keyed B at revision 5 and found its result: the listing re-resolves it.
    const [row] = store.testFileKeys.list(repo.mainId, [ref(B)]);
    if (row === undefined) throw new Error("no row");
    store.testFileKeys.upsertMany([{ ...row, revision: 5 as RevisionNumber }]);

    const got = await wait(repo.main, [B, C]);

    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(namedCode(got)).toBe(3);
  });
});

describe("fixedSelection (row 011-398)", () => {
  it("is fixed only when every named path is a listed test file", () => {
    const of = (...kinds: ("test-file" | "source" | "not-run" | "unmatched")[]) =>
      fixedSelection(kinds.map((kind) => ({ kind })));

    expect(of("test-file", "test-file")).toBe(true);
    expect(of("test-file", "source")).toBe(false);
    expect(of("test-file", "unmatched")).toBe(false);
    expect(of("not-run")).toBe(false);
  });
});
