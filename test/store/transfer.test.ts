import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { observedMetaKey } from "../../src/core/keys/observed.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import {
  AbsolutePathError,
  exportResults,
  importRefusal,
  importResults,
} from "../../src/core/store/transfer.js";
import { encodeBundle } from "../../src/core/store/transfer-bundle.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { claimRepo, fileName, type Side, side } from "../scheduler/claims-fixture.js";

/*
 * Spec 018 Testing, D2 and D3: a round trip between two fixture stores. A
 * repository runs its suite and exports; a second repository with the same
 * files imports into its own store, and its daemon finds every exported file
 * current, with origin `imported`, with no run.
 */

const COUNT = 4;
/** Each file stores two results: its file check and its one test. */
const RESULTS = 2 * COUNT;
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };
const SLOW = { timeout: 60_000 } as const;
const COMMIT = "c0ffee".padEnd(40, "0");
const METHOD = "static imports plus declared inputs" as const;
const HEADER = {
  squealVersion: "0.0.0-test",
  keyFormat: KEY_FORMAT_VERSION,
  commit: COMMIT,
  dirty: false,
  createdAt: 1,
  source: { kind: "local" },
} as const;

const tests = (s: Side): KnownState[] =>
  s.store.knownStates.list(s.worktreeId).filter((state) => state.check.kind === "test");

/** A repository whose suite ran, with `failing` failing, and its export. */
async function exported(failing: readonly string[] = []) {
  const { main } = claimRepo(COUNT);
  const a = side(main, { count: COUNT, policy: LOOKUP_ONLY });
  for (const path of failing) a.runner.failing.add(path);
  await a.scheduler.start();
  await a.scheduler.requestFullSuite();
  await a.scheduler.idle();
  return { a, ...exportResults(a.store, a.worktreeId, HEADER) };
}

/** A second repository with the same files, and its store open as `squeal import` opens it. */
function other(): { root: string; store: Store } {
  const { main } = claimRepo(COUNT);
  const store = openStore(join(main, ".git"), { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  return { root: main, store };
}

const options = { importId: "0123abcd", fileHash: "f".repeat(64), now: Date.now() };

describe("squeal export and import between two stores (018 D2, D3)", SLOW, () => {
  it("every exported file is current in the other store, imported, with no run", async () => {
    const { bundle, counts } = await exported();
    expect(counts).toMatchObject({ testFiles: COUNT, results: RESULTS, noKey: 0, failed: 0 });
    const b = other();
    expect(importResults(b.store, bundle, { ...options, now: Date.now() })).toMatchObject({
      results: RESULTS,
      alreadyStored: 0,
    });
    b.store.close();

    const s = side(b.root, { count: COUNT, policy: LOOKUP_ONLY });
    await s.scheduler.start();
    await s.scheduler.idle();
    expect(s.runner.runs).toEqual([]);
    expect(s.passing()).toBe(COUNT);
    for (const state of tests(s)) {
      expect(state.origin).toEqual({ kind: "imported", importId: "0123abcd", commit: COMMIT });
    }
  });

  it("a running daemon sees the imported results at its next pass, without a restart", async () => {
    const { bundle } = await exported();
    const b = other();
    const s = side(b.root, { count: COUNT, policy: LOOKUP_ONLY });
    await s.scheduler.start();
    await s.scheduler.idle();
    expect(s.passing()).toBe(0);

    importResults(b.store, bundle, { ...options, now: Date.now() });
    b.store.close();
    await s.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await s.scheduler.idle();
    expect(s.runner.runs).toEqual([]);
    expect(s.passing()).toBe(COUNT);
  });

  it("a file with one failure at its key is not exported", async () => {
    const { bundle, counts } = await exported([fileName(1)]);
    expect(counts).toMatchObject({ testFiles: COUNT - 1, results: RESULTS - 2, failed: 1 });
    expect(bundle.testFiles.map((f) => f.path)).not.toContain(fileName(1));
    expect(bundle.results.map((r) => r.testPath)).not.toContain(fileName(1));
  });

  it("an observed entry the store holds stays as it was, and its file is not current", async () => {
    const { a, bundle } = await exported();
    const theirs = JSON.stringify({ [fileName(0)]: [fileName(2)] });
    a.store.meta.set(observedMetaKey(""), theirs);
    const again = exportResults(a.store, a.worktreeId, HEADER).bundle;
    expect(again.testFiles.find((f) => f.path === fileName(0))?.observed).toEqual({
      observed: [fileName(2)],
    });
    const b = other();
    const ours = JSON.stringify({ [fileName(0)]: [fileName(3)] });
    b.store.meta.set(observedMetaKey(""), ours);
    importResults(b.store, again, { ...options, now: Date.now() });
    expect(b.store.meta.get(observedMetaKey(""))).toBe(ours);
    b.store.close();

    const s = side(b.root, { count: COUNT, policy: LOOKUP_ONLY });
    await s.scheduler.start();
    await s.scheduler.idle();
    expect(s.runner.runs).toEqual([]);
    const current = tests(s).filter((t) => t.validity === "current");
    expect(current.map((t) => t.check.testPath).sort()).toEqual(
      bundle.testFiles.map((f) => f.path).filter((p) => p !== fileName(0)),
    );
  });

  it("an observed entry the store lacks is added; one closure list per file the store lacks", async () => {
    const { a } = await exported();
    a.store.meta.set(observedMetaKey(""), JSON.stringify({ [fileName(2)]: ["test/seen.ts"] }));
    const { bundle } = exportResults(a.store, a.worktreeId, HEADER);
    const b = other();
    const counts = importResults(b.store, bundle, { ...options, now: Date.now() });
    expect(counts).toMatchObject({ observed: 1 });
    expect(JSON.parse(b.store.meta.get(observedMetaKey("")) ?? "{}")).toEqual({
      [fileName(2)]: ["test/seen.ts"],
    });
    expect(counts.closures).toBe(bundle.testFiles.filter((f) => f.closure !== null).length);
    expect(importResults(b.store, bundle, { ...options, now: Date.now() })).toMatchObject({
      results: 0,
      alreadyStored: RESULTS,
      closures: 0,
      observed: 0,
    });
  });

  it("a dry run writes nothing and counts as the import would", async () => {
    const { bundle } = await exported();
    const b = other();
    const dry = importResults(b.store, bundle, { ...options, now: Date.now(), dryRun: true });
    expect(dry).toMatchObject({ results: RESULTS });
    expect(b.store.results.keysSince(0)).toEqual([]);
    expect(importResults(b.store, bundle, { ...options, now: Date.now() })).toEqual(dry);
  });

  it("refuses another key format, and names both", async () => {
    const { bundle } = await exported();
    const header = { ...bundle.header, keyFormat: KEY_FORMAT_VERSION - 1 };
    expect(importRefusal({ ...bundle, header })).toBe(
      `the export's key format is ${KEY_FORMAT_VERSION - 1}; this Squeal's is ${KEY_FORMAT_VERSION}`,
    );
    expect(importRefusal(bundle)).toBeNull();
  });

  it("refuses to export an absolute path", async () => {
    const { a } = await exported();
    const testFile = { project: "", path: fileName(0) };
    const closure = { testFile, paths: ["/etc/passwd"], complete: true, method: METHOD };
    a.store.testFiles.put({ testFile, closure, updatedAt: 1, updatedBy: a.worktreeId });
    expect(() => exportResults(a.store, a.worktreeId, HEADER)).toThrow(
      new AbsolutePathError("/etc/passwd"),
    );
  });

  it("the file holds no absolute path, no failure text and no worktree id", async () => {
    const { a, bundle } = await exported([fileName(1)]);
    const text = gunzipSync(encodeBundle(bundle)).toString("utf8");
    for (const absent of [dirname(a.root), homedir(), a.worktreeId, "errors", "summary", '"no"']) {
      expect(text).not.toContain(absent);
    }
    expect(text).toContain(fileName(0));
  });
});
