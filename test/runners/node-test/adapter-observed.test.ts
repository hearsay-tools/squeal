import { describe, expect, it } from "vitest";
import {
  nodeTestObservedMetaKey,
  nodeTestObservedPreloadsMetaKey,
  observedStore,
} from "../../../src/core/daemon/node-test-runners.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/**
 * Spec 003 D3 as amended: the daemon keeps a node:test project's observed
 * paths in the shared `nodeTest.observed.<project>` meta key, merged on
 * write, and widens the stored closure a later worktree keys from.
 */

const FILE = "packages/a/test/hidden.test.ts";

describe("observedStore", () => {
  it("reads nothing from a missing or malformed key", () => {
    const store = open(fakeCommonDir());
    expect(observedStore(store, "a").read()).toEqual({});
    store.meta.set(nodeTestObservedMetaKey("a"), "{not json");
    expect(observedStore(store, "a").read()).toEqual({});
  });

  it("merges writes from two daemons per test file, sorted, per project", () => {
    const store = open(fakeCommonDir());
    const one = observedStore(store, "a");
    const two = observedStore(store, "a");
    one.write({ [FILE]: ["packages/a/src/z.ts"] });
    two.write({ [FILE]: ["packages/a/src/b.ts"], "packages/a/test/x.test.ts": ["x.ts"] });
    expect(one.read()).toEqual({
      [FILE]: ["packages/a/src/b.ts", "packages/a/src/z.ts"],
      "packages/a/test/x.test.ts": ["x.ts"],
    });
    expect(observedStore(store, "b").read()).toEqual({});
    expect(store.meta.get("nodeTest.observed.a")).not.toBeNull();
  });

  it("adds the paths to the stored closure, which a starting worktree keys from", () => {
    const store = open(fakeCommonDir());
    const testFile = { project: "a", path: FILE };
    store.testFiles.put({
      testFile,
      closure: {
        testFile,
        paths: [FILE, "packages/a/tsconfig.json"],
        complete: false,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: "w",
    });
    observedStore(store, "a").write({ [FILE]: ["packages/a/src/hidden.ts"] });
    expect(store.testFiles.get(testFile)?.closure.paths).toEqual([
      "packages/a/src/hidden.ts",
      FILE,
      "packages/a/tsconfig.json",
    ]);
    // A file the store never closed over is left to its first resolution.
    observedStore(store, "a").write({ "packages/a/test/new.test.ts": ["n.ts"] });
    expect(store.testFiles.get({ project: "a", path: "packages/a/test/new.test.ts" })).toBeNull();
  });

  it("merges the preloads' paths from two daemons, sorted, and reads a change at once", () => {
    const store = open(fakeCommonDir());
    const one = observedStore(store, "a");
    const two = observedStore(store, "a");
    expect(one.readPreloads()).toEqual([]);
    one.writePreloads(["scripts/z.mjs"]);
    expect(two.readPreloads()).toEqual(["scripts/z.mjs"]);
    two.writePreloads(["scripts/b.mjs", "scripts/z.mjs"]);
    expect(one.readPreloads()).toEqual(["scripts/b.mjs", "scripts/z.mjs"]);
    expect(observedStore(store, "b").readPreloads()).toEqual([]);
    store.meta.set(nodeTestObservedPreloadsMetaKey("a"), "{not json");
    expect(one.readPreloads()).toEqual([]);
  });
});
