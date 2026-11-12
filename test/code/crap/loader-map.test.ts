import { describe, expect, it } from "vitest";
import { COVERAGE_RECORD_VERSION, encodeRecord } from "../../../src/core/code/coverage/record.js";
import { StepCache } from "../../../src/core/code/crap/cache.js";
import { LoaderMap } from "../../../src/core/code/crap/loader-map.js";
import {
  LoaderBuild,
  type LoaderCondition,
  type LoaderInputs,
  type Loaders,
} from "../../../src/core/code/crap/loaders.js";
import { WT } from "../../state/helpers.js";
import { type CoverageRig, coverageRig } from "./rig.js";

/*
 * Row 021-31 (spec 021 D21.4): the loader map is kept across reads, and a
 * read moves only the sources of a test file whose closure or condition
 * changed. Before, each read rebuilt it over every closure path.
 */

const SOURCES = ["src/a.ts", "src/b.ts", "src/c.ts", "src/shared.ts", "src/env.ts"];

function inputs(rig: CoverageRig, settled = new Map<string, LoaderCondition>()): LoaderInputs {
  return {
    main: rig.main,
    closures: rig.closures,
    coverage: rig.store.coverage,
    worktreeId: WT,
    now: rig.clock,
    writing: false,
    settled,
  };
}

/** Reads the whole map into `map`. */
function read(rig: CoverageRig, map: LoaderMap): Loaders {
  const loaders = new LoaderBuild(inputs(rig), map).advance(() => true);
  if (loaders === null) throw new Error("the map was not read whole");
  return loaders;
}

/** Each source's loaders as a from-scratch read gives them, in one order. */
function view(loaders: Loaders, paths: readonly string[]) {
  return paths.map((path) =>
    loaders
      .of(path)
      .map((l) => `${l.testFile.path} ${JSON.stringify(l.condition)}`)
      .sort(),
  );
}

/** A record stored again at `path`'s key, as a later run at the key stores it (row 015-44). */
function storeAgain(rig: CoverageRig, path: string, at: number) {
  const record = { v: 1 as const, sources: [], unread: [] };
  const key = { resultKey: `key-${path}`, providerVersion: COVERAGE_RECORD_VERSION };
  rig.store.coverage.put(key, encodeRecord(record), at);
}

/** Three test files, each with its own sources and `src/shared.ts`, each with a record. */
function three(): CoverageRig {
  const rig = coverageRig();
  rig.loader("test/a.test.ts", { closure: ["src/a.ts", "src/shared.ts"], record: [] });
  rig.loader("test/b.test.ts", { closure: ["src/b.ts", "src/shared.ts"], record: [] });
  rig.loader("test/c.test.ts", { closure: ["src/c.ts"], record: [] });
  return rig;
}

describe("the loader map kept across reads (row 021-31)", () => {
  it("moves only the sources of the test file whose record was stored", () => {
    const rig = three();
    const map = new LoaderMap();
    read(rig, map);
    expect(map.moved()).toBe("all");

    storeAgain(rig, "test/a.test.ts", 5);
    const loaders = read(rig, map);

    expect([...(map.moved() as Set<string>)].sort()).toEqual([
      "src/a.ts",
      "src/shared.ts",
      "test/a.test.ts",
    ]);
    const a = loaders.of("src/a.ts")[0]?.condition;
    expect(a).toEqual({ kind: "ready", key: "key-test/a.test.ts", storedAt: 5 });
    read(rig, map);
    expect(map.moved()).toEqual(new Set());
  });

  it("makes a source's condition again only when its loaders moved", () => {
    const rig = three();
    const cache = new StepCache();
    const loaders = () => {
      const read = cache.loaders(
        (map) => new LoaderBuild(inputs(rig), map),
        () => true,
      );
      if (read === null) throw new Error("the map was not read whole");
      return read;
    };
    const first = loaders();
    const before = SOURCES.map((path) => cache.condition(path, first));

    storeAgain(rig, "test/a.test.ts", 5);
    cache.invalidate();
    const second = loaders();
    const after = SOURCES.map((path) => cache.condition(path, second));

    // src/a.ts and src/shared.ts moved; src/b.ts, src/c.ts and a source no test file loads did not.
    expect(SOURCES.map((_, i) => after[i] === before[i])).toEqual([false, true, true, false, true]);
    expect(after[0]).toMatchObject({ state: "ready", loaders: [{ storedAt: 5 }] });
  });

  it("gives what a read from scratch gives, through every kind of change", () => {
    const rig = three();
    const map = new LoaderMap();
    const paths = [
      ...SOURCES,
      "test/a.test.ts",
      "test/b.test.ts",
      "test/c.test.ts",
      "test/d.test.ts",
    ];
    const same = () => {
      const kept = read(rig, map);
      const fresh = read(rig, new LoaderMap());
      expect(view(kept, paths)).toEqual(view(fresh, paths));
      expect(kept.withoutImports).toBe(fresh.withoutImports);
      expect(kept.listed).toBe(fresh.listed);
    };
    same();
    // A record stored again; a closure that grows; one that shrinks.
    storeAgain(rig, "test/b.test.ts", 7);
    same();
    rig.loader("test/a.test.ts", {
      closure: ["src/a.ts", "src/b.ts", "src/shared.ts"],
      record: [],
    });
    same();
    rig.loader("test/b.test.ts", { closure: ["src/b.ts"], record: [] });
    same();
    // A new key with no result yet; a queued run; a skipped one.
    rig.loader("test/c.test.ts", { closure: ["src/c.ts"], key: "key-c2", outcomes: [] });
    same();
    rig.loader("test/c.test.ts", { closure: ["src/c.ts"], key: "key-c3", pending: "queued" });
    same();
    rig.loader("test/c.test.ts", { closure: ["src/c.ts"], key: "key-c4", outcomes: ["skip"] });
    same();
    // A test file whose closure is not known here loads every source, until its closure comes.
    rig.loader("test/d.test.ts", { closure: ["src/c.ts"], indexKey: null });
    same();
    rig.loader("test/d.test.ts", { closure: ["src/c.ts"], record: [] });
    same();
    // An environment in each test file's process (rows 015-75 and 015-86), then one with no records.
    rig.closures.setEnvironment({ runner: "node-test", files: ["src/env.ts"] });
    same();
    rig.closures.setEnvironment({ runner: "pytest", files: [] });
    same();
    rig.closures.setEnvironment(null);
    same();
    // A test file no longer listed leaves every source; with none listed, no source is judged.
    rig.main.testFileKeys.remove(WT, [{ project: "", path: "test/a.test.ts" }]);
    same();
    rig.main.testFileKeys.remove(
      WT,
      ["test/b.test.ts", "test/c.test.ts", "test/d.test.ts"].map((path) => ({ project: "", path })),
    );
    same();
    expect(map.moved()).toBe("all");
  });
});
