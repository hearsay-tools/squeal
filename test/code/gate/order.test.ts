import { describe, expect, it } from "vitest";
import { loaderOrder } from "../../../src/core/code/gate/order.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";

/*
 * Spec 020 D17.2 (row 020-17b): the order a runner gets its files in. The
 * changed paths go in ascending order of their loaders' summed stored
 * duration (the loader count with none stored), ties by path; each path's
 * loaders not given yet follow, then the files that load no changed path,
 * then the files whose closure is unknown. A path every file loads comes
 * last.
 */

const ref = (path: string, project = ""): TestFileRef => ({ project, path });

/** The order of `files`, each with what its closure loads (`null`: unknown) and its stored seconds. */
function order(
  changed: readonly RelativePath[],
  files: readonly (readonly [string, readonly string[] | null, number | null])[],
): string[] {
  const refs = files.map(([path]) => ref(path));
  const loads = new Map(refs.map((r, i) => [r, files[i]?.[1] ?? null]));
  const seconds = new Map(refs.map((r, i) => [r, files[i]?.[2] ?? null]));
  return loaderOrder(refs, changed, {
    loads: (r) => loads.get(r) ?? null,
    seconds: (r) => seconds.get(r) ?? null,
  }).map((r) => r.path);
}

describe("loaderOrder", () => {
  it("gives the loaders of the path whose loaders cost least first", () => {
    const files = [
      ["test/a.test.ts", ["src/hub.ts", "test/a.test.ts"], 1],
      ["test/b.test.ts", ["src/hub.ts", "src/big.ts", "test/b.test.ts"], 50],
      ["test/c.test.ts", ["src/hub.ts", "src/small.ts", "test/c.test.ts"], 3],
      ["test/d.test.ts", ["src/hub.ts", "src/small.ts", "test/d.test.ts"], 4],
    ] as const;
    // small: 3 + 4 = 7; big: 50; hub: every file, 58.
    expect(order(["src/big.ts", "src/hub.ts", "src/small.ts"], files)).toEqual([
      "test/c.test.ts",
      "test/d.test.ts",
      "test/b.test.ts",
      "test/a.test.ts",
    ]);
  });

  it("counts the loaders when no duration is stored, and breaks a tie by path", () => {
    const files = [
      ["test/a.test.ts", ["src/hub.ts", "src/x.ts"], null],
      ["test/b.test.ts", ["src/hub.ts", "src/y.ts"], null],
      ["test/c.test.ts", ["src/hub.ts", "src/y.ts"], null],
      ["test/d.test.ts", ["src/hub.ts", "src/w.ts"], null],
    ] as const;
    // w and x have one loader each, a tie that w wins by path; y has two; the hub four.
    expect(order(["src/hub.ts", "src/w.ts", "src/x.ts", "src/y.ts"], files)).toEqual([
      "test/d.test.ts",
      "test/a.test.ts",
      "test/b.test.ts",
      "test/c.test.ts",
    ]);
  });

  it("counts a file with no stored duration at the median of the others", () => {
    const files = [
      ["test/a.test.ts", ["src/p.ts"], null],
      ["test/b.test.ts", ["src/q.ts"], 2],
      ["test/c.test.ts", ["src/q.ts"], 3],
      ["test/d.test.ts", ["src/r.ts"], 10],
    ] as const;
    // p: the median 3; q: 2 + 3 = 5; r: 10.
    expect(order(["src/p.ts", "src/q.ts", "src/r.ts"], files)).toEqual([
      "test/a.test.ts",
      "test/b.test.ts",
      "test/c.test.ts",
      "test/d.test.ts",
    ]);
  });

  it("puts a hub that every file loads last, though its path sorts first", () => {
    const files = [
      ["test/a.test.ts", ["src/a-hub.ts"], 5],
      ["test/z.test.ts", ["src/a-hub.ts", "src/z-leaf.ts"], 5],
    ] as const;
    expect(order(["src/a-hub.ts", "src/z-leaf.ts"], files)).toEqual([
      "test/z.test.ts",
      "test/a.test.ts",
    ]);
  });

  it("gives the files that load no changed path next, and those with an unknown closure last", () => {
    const files = [
      ["test/a.test.ts", null, 1],
      ["test/b.test.ts", ["test/b.test.ts"], 1],
      ["test/c.test.ts", ["src/p.ts"], 9],
      ["test/d.test.ts", null, 1],
      ["test/e.test.ts", ["src/q.ts"], 1],
    ] as const;
    expect(order(["src/p.ts", "src/q.ts"], files)).toEqual([
      "test/e.test.ts",
      "test/c.test.ts",
      "test/b.test.ts",
      "test/a.test.ts",
      "test/d.test.ts",
    ]);
  });

  it("gives each file once, and keeps two projects' files of one path apart", () => {
    const refs = [ref("test/a.test.ts", "one"), ref("test/a.test.ts", "two")];
    const ordered = loaderOrder(refs, ["src/p.ts"], {
      loads: () => ["src/p.ts"],
      seconds: () => null,
    });
    expect(ordered).toEqual(refs);
  });
});
