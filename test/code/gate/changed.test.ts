import { describe, expect, it } from "vitest";
import { BaseRefError, changedFunctions, mergeBase } from "../../../src/core/code/gate/changed.js";
import { lines, names, ONE, POLICY, repo, TWO } from "./changed-fixture.js";

/*
 * Spec 020 D2: the changed functions of the working tree against the merge
 * base of a ref, in temporary git repositories under $TMPDIR.
 * `changed-counted.test.ts` has what is counted.
 */

describe("changedFunctions: what changed", () => {
  it("returns an edited function, not a moved one or a test callback that only shifted", async () => {
    const { root, write } = repo({
      "src/a.ts": lines("export function edited(x: number) { return x + 1; }", ONE),
      "src/b.ts": lines(TWO),
      "test/a.test.ts": lines(
        'it("one", () => { expect(1).toBe(1); });',
        'it("two", () => { expect(2).toBe(2); });',
      ),
    });
    write({
      "src/a.ts": lines("export function edited(x: number) { return x + 2; }"),
      "src/b.ts": lines(TWO, ONE),
      // "one" removed: "two" is now occurrence 0 of `<it>`, with its own body.
      "test/a.test.ts": lines('it("two", () => { expect(2).toBe(2); });'),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(names(changed.functions)).toEqual(["src/a.ts edited#0 edited"]);
    expect(changed.inErrors).toEqual([]);
    expect(changed.uncounted).toEqual([]);
  });

  it("returns an added function and a callback added before a same-named one, as added", async () => {
    const { root, write } = repo({
      "test/a.test.ts": lines('it("one", () => { expect(1).toBe(1); });'),
    });
    write({
      "test/a.test.ts": lines(
        'it("zero", () => { expect(0).toBe(0); });',
        'it("one", () => { expect(1).toBe(1); });',
        "export function helper() { return 0; }",
      ),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    // `<it>#1` holds the base's `<it>#0` body: shifted, not returned.
    expect(names(changed.functions)).toEqual([
      "test/a.test.ts <it>#0 added",
      "test/a.test.ts helper#0 added",
    ]);
  });

  it("reads a moved and edited function as added, and returns no removed function", async () => {
    const { root, write, remove } = repo({
      "src/a.ts": lines(ONE, TWO),
      "src/gone.ts": lines(ONE.replace("one", "three")),
    });
    write({ "src/a.ts": lines(ONE), "src/b.ts": lines(TWO.replace("x * 2", "x * 3")) });
    remove("src/gone.ts");

    const changed = await changedFunctions(root, "base", POLICY);

    expect(names(changed.functions)).toEqual(["src/b.ts two#0 added"]);
    expect(changed.counted.map((c) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns a nested function and the test callback that holds it", async () => {
    const { root, write } = repo({
      "test/a.test.ts": lines(
        'it("adds", () => {',
        "  const twice = (n: number) => n * 2;",
        "  expect(twice(1)).toBe(2);",
        "});",
      ),
    });
    write({
      "test/a.test.ts": lines(
        'it("adds", () => {',
        "  const twice = (n: number) => n + n;",
        "  expect(twice(1)).toBe(2);",
        "});",
      ),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(names(changed.functions)).toEqual([
      "test/a.test.ts <it>#0 edited",
      "test/a.test.ts <it>.twice#0 edited",
    ]);
  });

  it("reads committed, staged, unstaged and untracked changes against the merge base, not the ref's tip", async () => {
    const C = "export const c = () => 1;";
    const { root, git, write, commit } = repo({
      "src/a.ts": lines(ONE),
      "src/b.ts": lines(TWO),
      "src/c.ts": lines(C),
    });
    const fork = git("rev-parse", "base");
    commit({ "src/a.ts": lines(ONE.replace("return 2", "return 3")) });
    git("checkout", "-q", "base");
    commit({ "src/later.ts": lines('export const later = () => "later";') });
    git("checkout", "-q", "work");
    write({ "src/b.ts": lines(TWO.replace("x * 2", "x * 4")) });
    git("add", "src/b.ts");
    write({
      "src/c.ts": lines(C.replace("1", "2")),
      "src/new.ts": lines('export const made = () => "made";'),
    });
    write({
      ".gitignore": "ignored.ts\n",
      "ignored.ts": lines('export const hidden = () => "hidden";'),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(names(changed.functions)).toEqual([
      "src/a.ts one#0 edited",
      "src/b.ts two#0 edited",
      "src/c.ts c#0 edited",
      "src/new.ts made#0 added",
    ]);
    expect(changed).toMatchObject({
      ref: "base",
      baseCommit: fork,
      headCommit: git("rev-parse", "HEAD"),
      dirty: true,
    });
  });

  it("is clean when the tree matches HEAD, and the blob is git's blob id of the head bytes", async () => {
    const { root, git, commit } = repo({ "src/a.ts": lines(ONE) });
    commit({ "src/a.ts": lines(TWO) });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(changed.dirty).toBe(false);
    const blob = git("hash-object", "src/a.ts");
    expect(changed.functions.map((f) => f.blob)).toEqual([blob]);
    expect(changed.counted.map((c) => c.blob)).toEqual([blob]);
  });
});

describe("mergeBase", () => {
  it("throws BaseRefError for a ref that names no commit, an option and unrelated histories", async () => {
    const { root, git, commit } = repo({ "src/a.ts": lines(ONE) });
    git("checkout", "-q", "--orphan", "other");
    commit({ "src/x.ts": lines(TWO) });

    await expect(mergeBase(root, "nope")).rejects.toThrow(BaseRefError);
    await expect(mergeBase(root, "--all")).rejects.toThrow(BaseRefError);
    await expect(mergeBase(root, "base")).rejects.toThrow(/no common commit/);
    await expect(changedFunctions(root, "nope", POLICY)).rejects.toThrow(BaseRefError);
  });
});
