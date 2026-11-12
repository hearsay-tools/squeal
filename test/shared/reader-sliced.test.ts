import { afterEach, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { IMPORT_STEP } from "../../src/core/shared/reader.js";
import { readSquealMismatch } from "../../src/core/shared/refused.js";
import { observeWrites } from "../../src/core/store/connection.js";
import { decodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { publish, readerOf, scratch } from "./reader-kit.js";
import { cloneOf, cloneWith, exportOf, git } from "./remote.js";

/*
 * Spec 021 D3 (row 021-20) in the shared reader, on the 018 coordinator's
 * conditions: the reader imports in slices; the import's record is written
 * after the last slice, so a reader stopped between slices leaves the export
 * not held and the next reader fetches and imports it again; the D21 record
 * is cleared before the import's first slice; the import step brackets the
 * whole import.
 */

afterEach(() => observeWrites(null));

/** `commit`'s export with two test files, each with one pass at its own key. */
function withFiles(commit: string, header: Partial<ResultsBundle["header"]> = {}): Buffer {
  const plain = decodeBundle(exportOf(commit));
  if (typeof plain === "string") throw new Error(plain);
  const paths = ["t/a.test.ts", "t/b.test.ts"];
  return exportOf(commit, {
    header: { ...plain.header, ...header },
    testFiles: paths.map((path) => ({
      project: "",
      path,
      key: `key-${path}` as CheckKey,
      closure: { paths: [path], complete: true, method: "static imports plus declared inputs" },
      observed: { observed: [path] },
    })),
    results: paths.map((path) => ({
      project: "",
      testPath: path,
      kind: "file" as const,
      fullName: null,
      location: null,
      key: `key-${path}` as CheckKey,
      outcome: "pass" as const,
      durationMs: 1,
    })),
  });
}

describe("the shared reader's import in slices (021 D3, row 021-20)", () => {
  it("leaves an import stopped between slices not held, and the next reader imports it", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    await publish(ci.root, c0, withFiles(c0));
    const dev = cloneOf(s, "dev");
    const first = readerOf(dev);
    let transactions = 0;
    observeWrites(() => {
      // Stopped while its first slice holds the lock: the slice commits, no later one runs.
      if (++transactions === 1) first.reader.close();
      return null;
    });
    await first.run();
    observeWrites(null);
    expect(transactions).toBe(1);
    expect(first.commits()).toEqual([]);
    expect(first.imported()).toBe(0);

    const second = readerOf(dev, { store: first.store });
    await second.run();
    expect(second.commits()).toEqual([c0]);
    expect(second.imported()).toBe(1);
  });

  it("clears the D21 record before the first slice, and the step brackets every slice", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    await publish(ci.root, c0, withFiles(c0, { keyFormat: KEY_FORMAT_VERSION + 1 }));
    const dev = cloneOf(s, "dev");
    const events: string[] = [];
    const { run, store, commits } = readerOf(dev, {
      step: (operation, running) => events.push(`${operation}: ${running}`),
    });
    await run();
    const worktreeId = worktreeIdFor(dev);
    expect(readSquealMismatch(store, worktreeId)?.commit).toBe(c0);

    git(ci.root, ["commit", "-q", "--allow-empty", "-m", "c1"]);
    git(ci.root, ["push", "-q", "origin", "main"]);
    const c1 = git(ci.root, ["rev-parse", "HEAD"]);
    await publish(ci.root, c1, withFiles(c1));
    git(dev, ["pull", "-q", "--ff-only"]);
    observeWrites(() => {
      const record = readSquealMismatch(store, worktreeId);
      events.push(record === null ? "slice, no record" : "slice, record");
      return null;
    });
    await run();
    observeWrites(null);
    expect(commits()).toEqual([c1]);
    const slices = events.filter((e) => e.startsWith("slice"));
    expect(slices.length).toBeGreaterThanOrEqual(3);
    expect(new Set(slices)).toEqual(new Set(["slice, no record"]));
    expect(events).toEqual([`${IMPORT_STEP}: true`, ...slices, `${IMPORT_STEP}: false`]);
  });
});
