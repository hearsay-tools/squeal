import { describe, expect, it } from "vitest";
import { absentSegment, encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import { assembleClosure, checkKey, KeyIndex } from "../../src/core/keys/index.js";
import type { Closure, TestFileRef } from "../../src/core/types/index.js";

const ref = (path: string, project = "unit"): TestFileRef => ({ project, path });
const closureOf = (testFile: TestFileRef, paths: readonly string[]): Closure =>
  assembleClosure({ testFile, paths }, []);

/**
 * A hash table the test edits in place, as reconciliation edits the stat cache.
 * Paths in `untracked` read as `undefined`; every other unknown path is absent.
 */
const hashTable = (entries: Record<string, string>) => {
  const hashes = new Map(Object.entries(entries));
  const untracked = new Set<string>();
  let reads = 0;
  return {
    hashes,
    untracked,
    reads: () => reads,
    hashOf: (path: string): string | null | undefined => {
      reads++;
      if (untracked.has(path)) return undefined;
      return hashes.get(path) ?? null;
    },
  };
};

describe("KeyIndex", () => {
  const a = ref("test/a.test.ts");
  const b = ref("test/b.test.ts");

  const setup = () => {
    const table = hashTable({
      "src/x.ts": "x1",
      "src/y.ts": "y1",
      "test/a.test.ts": "a1",
      "test/b.test.ts": "b1",
    });
    const index = new KeyIndex(table.hashOf);
    index.setEnvironment("unit", "env1");
    index.setClosure(closureOf(a, ["src/x.ts"]));
    index.setClosure(closureOf(b, ["src/x.ts", "src/y.ts"]));
    return { table, index };
  };

  it("keys a test file when its closure and its project environment are known", () => {
    const table = hashTable({ "test/a.test.ts": "a1" });
    const index = new KeyIndex(table.hashOf);
    const closure = closureOf(a, []);

    expect(index.setClosure(closure)).toEqual({ changes: [], untracked: [] });
    expect(index.key(a)).toBeNull();

    const changes = index.setEnvironment("unit", "env1");
    const key = checkKey("env1", closure, (path) => table.hashOf(path) ?? null);
    expect(changes).toEqual([{ testFile: a, previous: null, key }]);
    expect(index.key(a)).toBe(key);
  });

  it("re-keys only the test files whose closure references a changed path", () => {
    const { table, index } = setup();
    const before = { a: index.key(a), b: index.key(b) };

    table.hashes.set("src/y.ts", "y2");
    const changes = index.rekey(["src/y.ts"]);

    expect(changes.map((c) => c.testFile)).toEqual([b]);
    expect(changes[0]?.previous).toBe(before.b);
    expect(index.key(a)).toBe(before.a);
    expect(index.key(b)).not.toBe(before.b);
  });

  it("reports nothing when a changed path's hash ends up where it started", () => {
    const { index } = setup();
    expect(index.rekey(["src/x.ts"])).toEqual([]);
    expect(index.rekey(["src/unrelated.ts"])).toEqual([]);
  });

  it("re-keys a project's test files when its environment hash changes", () => {
    const { index } = setup();
    index.setEnvironment("e2e", "envE");
    index.setClosure(closureOf(ref("test/a.test.ts", "e2e"), ["src/x.ts"]));

    const changes = index.setEnvironment("unit", "env2");

    expect(changes.map((c) => c.testFile)).toEqual([a, b]);
    expect(index.setEnvironment("unit", "env2")).toEqual([]);
  });

  it("replaces a closure and updates the reverse index", () => {
    const { table, index } = setup();
    const { changes } = index.setClosure(closureOf(a, ["src/y.ts"]));
    expect(changes.map((c) => c.testFile)).toEqual([a]);

    table.hashes.set("src/x.ts", "x2");
    expect(index.rekey(["src/x.ts"]).map((c) => c.testFile)).toEqual([b]);
    table.hashes.set("src/y.ts", "y2");
    expect(index.rekey(["src/y.ts"]).map((c) => c.testFile)).toEqual([a, b]);
  });

  it("re-keys other test files when a new closure finds a hash that changed unreported", () => {
    const { table, index } = setup();
    const c = ref("test/c.test.ts");
    table.hashes.set("test/c.test.ts", "c1");
    table.hashes.set("src/y.ts", "y2");

    const { changes } = index.setClosure(closureOf(c, ["src/y.ts"]));

    expect(changes.map((change) => change.testFile)).toEqual([c, b]);
  });

  it("reports nothing when a closure is set again unchanged", () => {
    const { index } = setup();
    expect(index.setClosure(closureOf(a, ["src/x.ts"]))).toEqual({ changes: [], untracked: [] });
  });

  it("forgets a removed test file", () => {
    const { table, index } = setup();
    expect(index.removeTestFile(a)).toBe(true);
    expect(index.key(a)).toBeNull();
    expect(index.closure(a)).toBeUndefined();
    table.hashes.set("src/x.ts", "x2");
    expect(index.rekey(["src/x.ts"]).map((c) => c.testFile)).toEqual([b]);
    expect(index.removeTestFile(a)).toBe(false);
  });

  it("answers a current key's test file with its keys at the formats read as one (011-38)", () => {
    const table = hashTable({ "src/x.ts": "x1", "test/a.test.ts": "a1" });
    const index = new KeyIndex(table.hashOf);
    const closure = closureOf(a, ["src/x.ts"]);
    index.setClosure(closure);
    const readAsOne = [{ environment: "e16" }, { environment: "e17" }];
    index.setInstalled(new Map([["unit", "env18"]]), () => "", new Map([["unit", readAsOne]]));
    const at = (env: string) => checkKey(env, closure, (path) => table.hashOf(path) ?? null);
    const key = index.key(a) ?? "";
    expect(key).toBe(at("env18"));
    expect(index.keysReadAsOne(key)).toEqual({ testFile: a, keys: [at("e16"), at("e17")] });

    // A key no test file holds now has none: an earlier key, or a forgotten file's.
    table.hashes.set("src/x.ts", "x2");
    index.rekey(["src/x.ts"]);
    expect(index.keysReadAsOne(key)).toBeNull();
    const moved = index.key(a) ?? "";
    expect(index.keysReadAsOne(moved)?.keys).toEqual([at("e16"), at("e17")]);
    // A provisional environment has no formats read as one.
    index.setEnvironment("unit", "provisional");
    const provisional = index.key(a) ?? "";
    expect(index.keysReadAsOne(provisional)).toEqual({ testFile: a, keys: [] });
    index.removeTestFile(a);
    expect(index.keysReadAsOne(provisional)).toBeNull();
  });

  it("reads each test file's segment from an entry that gives one, every other entry its own (011-90, review 0.1.253 B1)", () => {
    const table = hashTable({ "src/x.ts": "x1", "test/a.test.ts": "a1", "test/b.test.ts": "b1" });
    const index = new KeyIndex(table.hashOf);
    const [ca, cb] = [closureOf(a, ["src/x.ts"]), closureOf(b, [])];
    const segmentOf = (ref: TestFileRef) => (ref.path === a.path ? "whole:now" : "scoped");
    index.setClosure(ca, segmentOf(a));
    index.setClosure(cb, segmentOf(b));
    // Whole now, scoped then; scoped now, none then (an environment a sibling made opaque).
    const then = (ref: TestFileRef) => (ref.path === a.path ? "scoped-then" : "");
    const readAsOne = [{ environment: "e19" }, { environment: "former", segment: then }];
    index.setInstalled(new Map([["unit", "env20"]]), segmentOf, new Map([["unit", readAsOne]]));
    const at = (env: string, closure: Closure, segment: string) =>
      checkKey(env, closure, (path) => table.hashOf(path) ?? null, segment);
    expect(index.keysReadAsOne(index.key(a) ?? "")?.keys).toEqual([
      at("e19", ca, "whole:now"),
      at("former", ca, "scoped-then"),
    ]);
    expect(index.keysReadAsOne(index.key(b) ?? "")?.keys).toEqual([
      at("e19", cb, "scoped"),
      at("former", cb, ""),
    ]);
  });

  it("reads an entry's segment again after the closure is set again, with the same key (review 0.1.253 B1)", () => {
    const table = hashTable({ "test/a.test.ts": "a1" });
    const index = new KeyIndex(table.hashOf);
    const closure = closureOf(a, []);
    index.setClosure(closure, "whole:now");
    let then = "whole:then";
    const readAsOne = [{ environment: "former", segment: () => then }];
    index.setInstalled(
      new Map([["unit", "env20"]]),
      () => "whole:now",
      new Map([["unit", readAsOne]]),
    );
    const key = index.key(a) ?? "";
    const at = (segment: string) =>
      checkKey("former", closure, (path) => table.hashOf(path) ?? null, segment);
    expect(index.keysReadAsOne(key)?.keys).toEqual([at("whole:then")]);
    // The runner's closure arrives with packages: the same key, another segment then.
    then = "scoped-then";
    index.setClosure(closure, "whole:now");
    expect(index.key(a)).toBe(key);
    expect(index.keysReadAsOne(key)?.keys).toEqual([at("scoped-then")]);
  });

  // Row 011-158: the shared closure list names a path only another branch has.
  it("keys a closure that names an absent path as one that does not, and re-keys it when the path appears", () => {
    const here = hashTable({ "src/x.ts": "x1", "test/a.test.ts": "a1" });
    const there = hashTable({ "src/x.ts": "x1", "test/a.test.ts": "a1" });
    const [naming, own] = [new KeyIndex(here.hashOf), new KeyIndex(there.hashOf)];
    for (const index of [naming, own]) index.setEnvironment("unit", "env1");
    naming.setClosure(closureOf(a, ["src/focus.ts", "src/x.ts"]));
    own.setClosure(closureOf(a, ["src/x.ts"]));
    const key = own.key(a);
    expect(naming.key(a)).toBe(key);

    here.hashes.set("src/focus.ts", "f1");
    expect(naming.rekey(["src/focus.ts"])).toEqual([
      { testFile: a, previous: key, key: expect.any(String) },
    ]);
    expect(naming.key(a)).not.toBe(key);
    // Deleted again, it keys as before.
    here.hashes.delete("src/focus.ts");
    naming.rekey(["src/focus.ts"]);
    expect(naming.key(a)).toBe(key);
  });

  it("reads each key as one with an absent path's segment before 011-158, none equal to the current key", () => {
    const table = hashTable({ "src/x.ts": "x1", "test/a.test.ts": "a1", "test/b.test.ts": "b1" });
    const index = new KeyIndex(table.hashOf);
    index.setClosure(closureOf(a, ["src/focus.ts", "src/x.ts"]));
    index.setClosure(closureOf(b, ["src/x.ts"]));
    // The current hash, as `absentReadAsOne` gives it, then a format read as one.
    const readAsOne = [{ environment: "env20" }, { environment: "e19" }];
    index.setInstalled(new Map([["unit", "env20"]]), () => "", new Map([["unit", readAsOne]]));
    const former = (env: string) =>
      keyFromSegments(env, a, [
        absentSegment("src/focus.ts"),
        encodeSegment("src/x.ts", "x1"),
        encodeSegment(a.path, "a1"),
      ]);
    expect(index.keysReadAsOne(index.key(a) ?? "")?.keys).toEqual([former("env20"), former("e19")]);
    // With no absent path the current hash keys as the current key.
    const bAt = (env: string) =>
      checkKey(env, closureOf(b, ["src/x.ts"]), (p) => table.hashOf(p) ?? null);
    expect(index.keysReadAsOne(index.key(b) ?? "")?.keys).toEqual([bAt("e19")]);
  });

  it("reads an entry stored after 011-158 too both ways, a key read twice once (review 0.1.282, third round)", () => {
    const table = hashTable({ "src/x.ts": "x1", "test/a.test.ts": "a1", "test/b.test.ts": "b1" });
    const index = new KeyIndex(table.hashOf);
    index.setClosure(closureOf(a, ["src/focus.ts", "src/x.ts"]));
    index.setClosure(closureOf(b, ["src/x.ts"]));
    // Today's pnpm definition, whose rows were stored before 011-158 and after it.
    const readAsOne = [{ environment: "pnpm", storedAfter158: true as const }];
    index.setInstalled(new Map([["unit", "env20"]]), () => "", new Map([["unit", readAsOne]]));
    const aAt = (absent: boolean) =>
      keyFromSegments("pnpm", a, [
        ...(absent ? [absentSegment("src/focus.ts")] : []),
        encodeSegment("src/x.ts", "x1"),
        encodeSegment(a.path, "a1"),
      ]);
    expect(index.keysReadAsOne(index.key(a) ?? "")?.keys).toEqual([aAt(true), aAt(false)]);
    const bAt = checkKey("pnpm", closureOf(b, ["src/x.ts"]), (p) => table.hashOf(p) ?? null);
    expect(index.keysReadAsOne(index.key(b) ?? "")?.keys).toEqual([bAt]);
  });

  it("returns untracked closure paths and keys the test file only once they are hashed", () => {
    const { table, index } = setup();
    const c = ref("test/c.test.ts");
    table.hashes.set("test/c.test.ts", "c1");
    table.untracked.add("src/gen/client.ts");

    const result = index.setClosure(closureOf(c, ["src/gen/client.ts", "src/x.ts"]));

    expect(result).toEqual({ changes: [], untracked: ["src/gen/client.ts"] });
    expect(index.key(c)).toBeNull();

    // The caller hashes the path into the stat cache, then reports it.
    table.untracked.delete("src/gen/client.ts");
    table.hashes.set("src/gen/client.ts", "g1");
    const keyed = index.rekey(["src/gen/client.ts"]);
    expect(keyed).toEqual([{ testFile: c, previous: null, key: expect.any(String) }]);
    expect(index.key(c)).toBe(keyed[0]?.key);
  });

  it("treats a known-absent path as tracked", () => {
    const { index } = setup();
    const c = ref("test/c.test.ts");
    const result = index.setClosure(closureOf(c, ["test/__snapshots__/c.test.ts.snap"]));
    expect(result.untracked).toEqual([]);
    expect(result.changes.map((change) => change.testFile)).toEqual([c]);
  });

  it("drops the key of a test file whose new closure has an untracked path", () => {
    const { table, index } = setup();
    const before = index.key(a);
    table.untracked.add("src/gen/client.ts");

    const result = index.setClosure(closureOf(a, ["src/gen/client.ts", "src/x.ts"]));

    expect(result).toEqual({
      changes: [{ testFile: a, previous: before, key: null }],
      untracked: ["src/gen/client.ts"],
    });
    expect(index.key(a)).toBeNull();
    // Another closure sharing the untracked path reports it too.
    expect(index.setClosure(closureOf(b, ["src/gen/client.ts"])).untracked).toEqual([
      "src/gen/client.ts",
    ]);
    expect(index.key(b)).toBeNull();
  });

  it("re-keys 5,000 closures of 300 paths in under 1 s", () => {
    const pool = Array.from({ length: 20_000 }, (_, i) => `src/m${Math.floor(i / 100)}/f${i}.ts`);
    const table = hashTable(Object.fromEntries(pool.map((p, i) => [p, `${i}`.padStart(40, "0")])));
    table.hashes.set("src/shared.ts", "s1");
    const index = new KeyIndex(table.hashOf);
    index.setEnvironment("unit", "env1");

    const files: TestFileRef[] = [];
    for (let t = 0; t < 5_000; t++) {
      const testFile = ref(`test/t${t}.test.ts`);
      table.hashes.set(testFile.path, `t${t}`);
      const paths = ["src/shared.ts"];
      for (let k = 0; k < 298; k++)
        paths.push(pool[(t * 7919 + k * 104_729) % pool.length] as string);
      index.setClosure(closureOf(testFile, paths));
      files.push(testFile);
    }
    expect(index.closure(files[0] as TestFileRef)?.paths).toHaveLength(300);

    // Best of three, so other test files and processes competing for the CPU do not decide it.
    const timings: number[] = [];
    for (const hash of ["s2", "s3", "s4"]) {
      table.hashes.set("src/shared.ts", hash);
      const started = performance.now();
      const changes = index.rekey(["src/shared.ts"]);
      timings.push(performance.now() - started);
      expect(changes).toHaveLength(5_000);
    }
    expect(Math.min(...timings)).toBeLessThan(1_000);

    // Incremental: only the changed path's hash is read, only its three closures are re-keyed.
    const rare = "src/rare.ts";
    table.hashes.set(rare, "r1");
    for (const testFile of files.slice(0, 3)) {
      const closure = index.closure(testFile) as Closure;
      index.setClosure(closureOf(testFile, [...closure.paths, rare]));
    }
    table.hashes.set(rare, "r2");
    const readsBefore = table.reads();
    expect(index.rekey([rare]).map((c) => c.testFile)).toEqual(files.slice(0, 3));
    expect(table.reads() - readsBefore).toBe(1);
    // Building 5,000 closures is setup, not the measured re-key; give it room on a loaded machine.
  }, 60_000);
});
