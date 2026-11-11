import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFunctions } from "../../../src/core/code/gate/changed.js";
import { lines, names, ONE, POLICY, repo, TWO } from "./changed-fixture.js";

/*
 * Spec 020 D2: what the changed functions of the working tree count: the
 * head functions of each changed path, and the paths left uncounted with
 * their reason, in temporary git repositories under $TMPDIR.
 */

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
