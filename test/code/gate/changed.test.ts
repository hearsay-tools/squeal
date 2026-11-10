import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaseRefError, changedFunctions, mergeBase } from "../../../src/core/code/gate/changed.js";
import type { ChangedFunction } from "../../../src/core/code/gate/types.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

/*
 * Spec 020 D2: the changed functions of the working tree against the merge
 * base of a ref, in temporary git repositories under $TMPDIR.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const POLICY = {
  include: DEFAULT_POLICY.complexity.include,
  exclude: DEFAULT_POLICY.complexity.exclude,
  maxFileBytes: DEFAULT_POLICY.complexity.maxFileBytes,
};

type Files = Readonly<Record<string, string>>;

/** A repository whose one commit holds `files` on branch `base`, checked out on branch `work`. */
function repo(files: Files) {
  const root = mkdtempSync(join(tmpdir(), "squeal-gate-changed-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  const write = (more: Files) => {
    for (const [path, text] of Object.entries(more)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  };
  const commit = (more: Files, message = "c") => {
    write(more);
    git("add", "-A");
    git("commit", "-qm", message);
  };
  git("init", "-q", "-b", "base");
  commit(files, "base");
  git("checkout", "-q", "-b", "work");
  return { root, git, write, commit, remove: (path: string) => rmSync(join(root, path)) };
}

const lines = (...text: string[]) => `${text.join("\n")}\n`;

function names(fns: readonly ChangedFunction[]): string[] {
  return fns.map((f) => `${f.path} ${f.count.qualifiedName}#${f.count.occurrence} ${f.change}`);
}

const ONE = "export function one(x: number) { if (x) return 1; return 2; }";
const TWO = "export function two(x: number) { return x * 2; }";

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

describe("changedFunctions: what is counted", () => {
  it("lists every head function of each changed path in counted, sorted, also when all of them moved", async () => {
    const { root, write } = repo({ "src/z.ts": lines(ONE, TWO), "src/b.ts": "" });
    write({
      "src/z.ts": lines(TWO, "export function added() { return 9; }"),
      "src/b.ts": lines(ONE),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(changed.counted.map((c) => [c.path, c.functions.map((f) => f.qualifiedName)])).toEqual([
      ["src/b.ts", ["one"]],
      ["src/z.ts", ["two", "added"]],
    ]);
    expect(names(changed.functions)).toEqual(["src/z.ts added#0 added"]);
  });

  it("names a head file over maxFileBytes too-large with its blob, and keeps it out of counted", async () => {
    const { root, git, write } = repo({ "src/a.ts": lines(ONE), "src/big.ts": lines(TWO) });
    write({
      "src/a.ts": lines(ONE.replace("return 2", "return 5")),
      "src/big.ts": lines(TWO, `// ${"x".repeat(200)}`),
    });

    const changed = await changedFunctions(root, "base", { ...POLICY, maxFileBytes: 120 });

    expect(changed.uncounted).toEqual([
      { path: "src/big.ts", reason: "too-large", blob: git("hash-object", "src/big.ts") },
    ]);
    expect(changed.counted.map((c) => c.path)).toEqual(["src/a.ts"]);
    expect(names(changed.functions)).toEqual(["src/a.ts one#0 edited"]);
  });

  it("reads every head function as added when the base file was over maxFileBytes", async () => {
    const { root, write } = repo({ "src/a.ts": lines(ONE, TWO, `// ${"x".repeat(200)}`) });
    write({ "src/a.ts": lines(ONE, TWO) });

    const changed = await changedFunctions(root, "base", { ...POLICY, maxFileBytes: 160 });

    expect(names(changed.functions)).toEqual(["src/a.ts one#0 added", "src/a.ts two#0 added"]);
  });

  it("puts a parse-error file in counted and uncounted, and its changed functions in an error range in inErrors", async () => {
    const after = "export function after() { return 3; }";
    const { root, write } = repo({
      "src/a.ts": lines(
        "export function ok(x: number) { return x + 1; }",
        "export function broken(x: number) { return x * 2; }",
        after,
      ),
    });
    write({
      "src/a.ts": lines(
        "export function ok(x: number) { return x + 9; }",
        "export function broken(x: number) { const y = x +* 2; return y; }",
        after,
      ),
    });

    const changed = await changedFunctions(root, "base", POLICY);

    expect(names(changed.functions)).toEqual(["src/a.ts ok#0 edited"]);
    expect(names(changed.inErrors)).toEqual(["src/a.ts broken#0 edited"]);
    expect(changed.uncounted).toEqual([
      { path: "src/a.ts", reason: "parse-error", blob: changed.counted[0]?.blob },
    ]);
    expect(changed.counted.map((c) => c.functions.map((f) => f.qualifiedName))).toEqual([
      ["ok", "broken", "after"],
    ]);
  });

  it("lists uncounted paths in path order, whatever their reason", async () => {
    const { root, git, write } = repo({ "README.md": "x\n" });
    write({
      "src/a.ts": lines("export function a() { return 1 +* 2; }"),
      "src/b.ts": lines(TWO, `// ${"x".repeat(200)}`),
      "src/c.ts": lines("export function c() { return 3 +* 4; }"),
    });

    const changed = await changedFunctions(root, "base", { ...POLICY, maxFileBytes: 120 });

    const blob = (path: string) => git("hash-object", path);
    expect(changed.uncounted).toEqual([
      { path: "src/a.ts", reason: "parse-error", blob: blob("src/a.ts") },
      { path: "src/b.ts", reason: "too-large", blob: blob("src/b.ts") },
      { path: "src/c.ts", reason: "parse-error", blob: blob("src/c.ts") },
    ]);
  });

  it("names a symlink unsupported and keeps it out of counted", async () => {
    const { root } = repo({ "src/a.ts": lines(ONE) });
    symlinkSync("a.ts", join(root, "src/link.ts"));

    const changed = await changedFunctions(root, "base", POLICY);

    expect(changed.uncounted).toEqual([{ path: "src/link.ts", reason: "unsupported" }]);
    expect(changed.counted).toEqual([]);
  });

  it("counts only JS/TS paths inside include, outside exclude and outside node_modules", async () => {
    const { root, write } = repo({ "README.md": "x\n" });
    write({
      "src/a.mjs": lines("export function js() { return 1; }"),
      "lib/b.ts": lines("export function lib() { return 1; }"),
      "src/dist/c.ts": lines("export function built() { return 1; }"),
      "src/node_modules/d.ts": lines("export function dep() { return 1; }"),
      "src/e.py": "def py():\n    return 1\n",
      "README.md": "y\n",
    });

    const changed = await changedFunctions(root, "base", { ...POLICY, include: ["src/**"] });

    expect(names(changed.functions)).toEqual(["src/a.mjs js#0 added"]);
  });

  it("lists every changed path in paths, uncounted and removed ones included (D3.1)", async () => {
    const { root, write, remove } = repo({ "README.md": "x\n", "src/gone.ts": lines(ONE) });
    write({
      "README.md": "y\n",
      "lib/b.ts": lines("export function lib() { return 1; }"),
      "src/e.py": "def py():\n    return 1\n",
      "test/a.test.ts": lines(ONE),
    });
    remove("src/gone.ts");

    const changed = await changedFunctions(root, "base", { ...POLICY, include: ["src/**"] });

    expect(changed.paths).toEqual([
      "README.md",
      "lib/b.ts",
      "src/e.py",
      "src/gone.ts",
      "test/a.test.ts",
    ]);
    expect(changed.counted).toEqual([]);
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
