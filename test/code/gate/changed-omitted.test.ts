import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFunctions } from "../../../src/core/code/gate/changed.js";
import type { ChangedSet } from "../../../src/core/code/gate/types.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

/*
 * Spec 020 D16 (row 020-18, #177): the head functions the diff's changed
 * lines touch and D2 does not judge, each with its reason. The first case
 * is the fixture of `research/probes/issue-177/fixture.sh`.
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

/** A repository whose one commit holds `files` on branch `base`, with `head` written over it. */
function repo(files: Files, head: Files): { root: string; git: (...a: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), "squeal-gate-omitted-"));
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
  git("init", "-q", "-b", "base");
  write(files);
  git("add", "-A");
  git("commit", "-qm", "base");
  write(head);
  return { root, git };
}

const lines = (...text: string[]) => `${text.join("\n")}\n`;

/** Each left-out function as `path name#occurrence line reason [<- base path name#occurrence]`. */
function omitted(changed: ChangedSet): string[] {
  return (changed.omitted ?? []).map((o) => {
    const from =
      o.base === undefined ? "" : ` <- ${o.base.path} ${o.base.qualifiedName}#${o.base.occurrence}`;
    return `${o.path} ${o.qualifiedName}#${o.occurrence} ${o.line} ${o.reason}${from}`;
  });
}

const judged = (changed: ChangedSet) =>
  changed.functions.map(
    (f) => `${f.path} ${f.count.qualifiedName}#${f.count.occurrence} ${f.change}`,
  );

const OLD = lines(
  "export function clamp(x: number): number {",
  "  if (x < 0) return 0;",
  "  return x > 9 ? 9 : x;",
  "}",
  "export function sign(x: number): number {",
  "  return x < 0 ? -1 : 1;",
  "}",
  "export function oldName(x: number): number {",
  "  return x + 1;",
  "}",
  "export function main(x: number): number {",
  "  return clamp(x) * sign(x);",
  "}",
);

const OLD_TEST = lines(
  'import { describe, expect, it } from "vitest";',
  'import { main } from "../src/old";',
  'describe("main", () => {',
  '  it("clamps", () => {',
  "    expect(main(12)).toBe(9);",
  "  });",
  '  it("signs", () => {',
  "    expect(main(5)).toBe(5);",
  "  });",
  '  it("keeps", () => {',
  "    expect(main(4)).toBe(4);",
  "  });",
  '  it("noop", () => {});',
  "});",
);

const HELPERS = lines(
  "export function clamp(x: number): number {",
  "  if (x < 0) return 0;",
  "  return x > 9 ? 9 : x;",
  "}",
  "export function sign(x: number): number {",
  "  return x < 0 ? -1 : 1;",
  "}",
  "export function newName(x: number): number {",
  "  return x + 1;",
  "}",
);

const NEW = lines(
  'import { clamp, sign } from "./helpers";',
  "export function main(x: number): number {",
  "  const c = clamp(x);",
  "  return c * sign(x);",
  "}",
);

// "clamps" retitled, "signs" reindented, "keeps" given the base "clamps" body,
// "noop two" added with the base "noop" body, "zero" added with its own.
const NEW_TEST = lines(
  'import { describe, expect, it } from "vitest";',
  'import { main } from "../src/old";',
  'describe("main", () => {',
  '  it("clamps above nine", () => {',
  "    expect(main(12)).toBe(9);",
  "  });",
  '  it("signs", () => {',
  "      expect(main(5)).toBe(5);",
  "  });",
  '  it("keeps", () => {',
  "    expect(main(12)).toBe(9);",
  "  });",
  '  it("noop", () => {});',
  '  it("noop two", () => {});',
  '  it("zero", () => {',
  "    expect(main(0)).toBe(0);",
  "  });",
  "});",
);

const IT = "<describe>.<it>";

describe("changedFunctions: the functions left out (D16)", () => {
  it("judges 3 and leaves out 7 of the #177 fixture, each with its reason", async () => {
    const { root } = repo(
      { "src/old.ts": OLD, "test/old.test.ts": OLD_TEST },
      { "src/helpers.ts": HELPERS, "src/old.ts": NEW, "test/old.test.ts": NEW_TEST },
    );

    const changed = await changedFunctions(root, "base", POLICY);

    expect(judged(changed)).toEqual([
      "src/old.ts main#0 edited",
      "test/old.test.ts <describe>#0 edited",
      `test/old.test.ts ${IT}#5 added`,
    ]);
    // "noop" is unchanged too, but no changed line touches it.
    expect(omitted(changed)).toEqual([
      "src/helpers.ts clamp#0 1 moved <- src/old.ts clamp#0",
      "src/helpers.ts newName#0 8 moved <- src/old.ts oldName#0",
      "src/helpers.ts sign#0 5 moved <- src/old.ts sign#0",
      `test/old.test.ts ${IT}#0 4 unchanged`,
      `test/old.test.ts ${IT}#1 7 unchanged`,
      `test/old.test.ts ${IT}#2 10 moved <- test/old.test.ts ${IT}#0`,
      `test/old.test.ts ${IT}#4 14 moved <- test/old.test.ts ${IT}#3`,
    ]);
  });
});

const A = lines("export function a(x: number) {", "  return x + 1;", "}");
const B = lines("export function b(x: number) {", "  return x * 2;", "}");
const C = lines("export function c(x: number) {", "  return x - 3;", "}");

describe("changedFunctions: a function no changed line touches is not left out", () => {
  it("lists none for unchanged functions between edits, whatever diff.interHunkContext says", async () => {
    const { root, git } = repo({ "src/m.ts": `${A}${B}${C}` }, {});
    git("config", "diff.interHunkContext", "10");
    writeFileSync(
      join(root, "src/m.ts"),
      `${A.replace("+ 1", "+ 2")}${B}${C.replace("- 3", "- 4")}`,
    );

    const changed = await changedFunctions(root, "base", POLICY);

    expect(judged(changed)).toEqual(["src/m.ts a#0 edited", "src/m.ts c#0 edited"]);
    expect(changed.omitted).toEqual([]);
  });

  it("lists a function whose blank line was removed, not the one before the removal", async () => {
    const { root } = repo(
      { "src/m.ts": lines("export function a(x: number) {", "", "  return x + 1;", "}", "") + B },
      { "src/m.ts": lines("export function a(x: number) {", "  return x + 1;", "}") + B },
    );

    const changed = await changedFunctions(root, "base", POLICY);

    // The second removal sits between `a` and `b`, inside neither.
    expect(judged(changed)).toEqual([]);
    expect(omitted(changed)).toEqual(["src/m.ts a#0 1 unchanged"]);
  });

  it("reads a file added with intent to add like an untracked one", async () => {
    const { root, git } = repo({ "src/m.ts": `${A}${B}` }, { "src/m.ts": A, "src/n.ts": B });
    git("add", "-N", "src/n.ts");

    const changed = await changedFunctions(root, "base", POLICY);

    expect(omitted(changed)).toEqual(["src/n.ts b#0 1 moved <- src/m.ts b#0"]);
  });

  it("names the first base function, by path and name, of a body held twice", async () => {
    // Only changed paths count at the base: `src/y.ts` is removed and `src/x.ts` edited.
    const twin = B.replace("function b", "function a");
    const { root, git } = repo(
      { "src/y.ts": B, "src/x.ts": `${C}${twin}` },
      { "src/z.ts": B, "src/x.ts": `${C.replace("- 3", "- 4")}${twin}` },
    );
    git("rm", "-q", "src/y.ts");

    const changed = await changedFunctions(root, "base", POLICY);

    expect(judged(changed)).toEqual(["src/x.ts c#0 edited"]);
    expect(omitted(changed)).toEqual(["src/z.ts b#0 1 moved <- src/x.ts a#0"]);
  });
});
