import { describe, expect, it } from "vitest";
import { assembleClosure, checkKey, KeyIndex } from "../../src/core/keys/index.js";
import type { Closure, TestFileRef } from "../../src/core/types/index.js";

const ref = (path: string, project = "unit"): TestFileRef => ({ project, path });
const closureOf = (testFile: TestFileRef, paths: readonly string[]): Closure =>
  assembleClosure({ testFile, paths }, []);

/** A hash table the test edits in place, as reconciliation edits the stat cache. */
const hashTable = (entries: Record<string, string>) => {
  const hashes = new Map(Object.entries(entries));
  let reads = 0;
  return {
    hashes,
    reads: () => reads,
    hashOf: (path: string) => {
      reads++;
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

    expect(index.setClosure(closure)).toEqual([]);
    expect(index.key(a)).toBeNull();

    const changes = index.setEnvironment("unit", "env1");
    const key = checkKey("env1", closure, table.hashOf);
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
    const changes = index.setClosure(closureOf(a, ["src/y.ts"]));
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

    const changes = index.setClosure(closureOf(c, ["src/y.ts"]));

    expect(changes.map((change) => change.testFile)).toEqual([c, b]);
  });

  it("reports nothing when a closure is set again unchanged", () => {
    const { index } = setup();
    expect(index.setClosure(closureOf(a, ["src/x.ts"]))).toEqual([]);
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
