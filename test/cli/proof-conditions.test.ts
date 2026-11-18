import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { prove, resultRows } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-11, done-when; spec 023 D5.3: `squeal proof --case dependency`
 * with each condition, on `$TMPDIR` git fixtures with the real Vitest
 * adapter. The old test passes only through a hidden dependency (a file
 * in `HOME`, a variable, a file in the repository); the new one does not
 * read it. Under the condition the old test fails its assertion and the
 * new one passes, both over the code at HEAD. The command's `HOME` is the
 * fixture's own.
 */

const TEST = ref("test/a.test.ts");
const CODE = { "squeal.config.json": "{}\n", "src/a.ts": GREETING() };

function GREETING(): string {
  return 'export const greeting = (name: string) => `hello ${name || "world"}`;\n';
}

/** A test that greets the name `read` gives: an expression over `node:fs`, `homedir` and `join`. */
function greets(read: string): string {
  return [
    'import { existsSync, readFileSync } from "node:fs";',
    'import { homedir } from "node:os";',
    'import { join } from "node:path";',
    'import { expect, it } from "vitest";',
    'import { greeting } from "../src/a";',
    'it("greets", () => {',
    `  const name: string = ${read};`,
    '  expect(greeting(name)).toBe("hello ada");',
    "});",
    "",
  ].join("\n");
}

const FIXED = greets('"ada"');
const fromFile = (path: string) =>
  `existsSync(${path}) ? readFileSync(${path}, "utf8").trim() : ""`;

/** Commit A holds the old test (`read`); HEAD the new one, which reads nothing. */
function dependencyFix(read: string, more: Readonly<Record<string, string>> = {}) {
  const f = fixture({ ...CODE, ...more, [TEST.path]: greets(read) });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [TEST.path]: FIXED });
  return { f, a };
}

/** A `HOME` of the fixture's with `.proofrc` and a file beside it. */
function homeOf(dir: string): string {
  const home = join(dir, "home");
  mkdirSync(join(home, ".config"), { recursive: true });
  writeFileSync(join(home, ".proofrc"), "ada\n");
  writeFileSync(join(home, ".config", "other"), "kept\n");
  return home;
}

describe("squeal proof conditions (row 023-11, D5.3)", { timeout: 240_000 }, () => {
  it("proves a hidden HOME dependency with --without: the old test read the file, the new one does not", async () => {
    const { f, a } = dependencyFix(fromFile('join(homedir(), ".proofrc")'));
    const home = homeOf(f.dir);
    const env = { ...process.env, HOME: home };
    const options = undefined;

    // With the file in HOME, the old test passes: the run reads the command's HOME.
    const plain = await prove(f, { files: [TEST.path], base: a, case: "test" }, options, env);
    expect(plain.code, plain.err).toBe(1);
    expect(plain.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
    clean(f);

    const without = [join(home, ".proofrc")];
    const args = { files: [TEST.path], base: a, case: "dependency" as const, without };
    const result = await prove(f, args, options, env);
    expect(result.code, result.err).toBe(0);
    expect(result.report).toMatchObject({
      case: "dependency",
      red: { tests: a, code: result.report.head },
      conditions: { env: [], without: [{ path: join(home, ".proofrc"), where: "home" }] },
    });
    const [file] = result.files;
    expect(file).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: false, runs: 1 },
      green: { end: "pass", from: "run", stored: false, runs: 1 },
    });
    expect(file?.red.notStored).toBe("a side under a condition is never stored");
    expect(file?.red.failures[0]?.text).toContain("expected 'hello world' to be 'hello ada'");
    clean(f);
  });

  it("proves a hidden variable with --env NAME=, runs both sides on every call and stores nothing", async () => {
    const { f, a } = dependencyFix('process.env.PROOF_NAME ?? ""');
    const env = { ...process.env, PROOF_NAME: "ada" };
    const args = {
      files: [TEST.path],
      base: a,
      case: "dependency" as const,
      env: [{ name: "PROOF_NAME", value: null }],
    };
    const before = resultRows(f);

    const first = await prove(f, args, undefined, env);
    expect(first.code, first.err).toBe(0);
    expect(first.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: false },
      green: { end: "pass", from: "run", stored: false },
    });
    expect(first.report.runs).toBe(2);
    expect(first.report.conditions.env).toEqual([{ name: "PROOF_NAME", value: null }]);
    clean(f);

    const second = await prove(f, { ...args, json: false }, undefined, env);
    expect(second.code, second.err).toBe(0);
    expect(second.out).toContain("Conditions on both sides: --env PROOF_NAME= (unset).");
    expect(second.out).toContain(
      "red: fail, run by this command, not stored (a side under a condition is never stored)",
    );
    expect(second.out).toContain("1 proven, ");
    expect(second.out).toContain("; 2 runs (");
    expect(resultRows(f)).toBe(before);
    clean(f);
  });

  it("hides a repository path in the checkout, which still passes the whole-checkout check", async () => {
    const { f, a } = dependencyFix(fromFile('join(process.cwd(), "config/local.txt")'), {
      "config/local.txt": "ada\n",
    });
    const args = {
      files: [TEST.path],
      base: a,
      case: "dependency" as const,
      without: ["config/local.txt"],
    };
    const result = await prove(f, args);
    expect(result.code, result.err).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", notStored: "a side under a condition is never stored" },
      green: { end: "pass" },
    });
    expect(result.report.conditions.without).toEqual([
      { path: "config/local.txt", where: "repository" },
    ]);
    clean(f);
  });

  it("refuses a --without path outside the repository and HOME, with no checkout (exit 2)", async () => {
    const { f, a } = dependencyFix('process.env.PROOF_NAME ?? ""');
    const env = { ...process.env, HOME: homeOf(f.dir) };
    const args = { files: [TEST.path], base: a, case: "dependency" as const, without: ["/etc/x"] };
    const result = await prove(f, args, undefined, env);
    expect(result.code).toBe(2);
    expect(result.err.trim().split("\n")).toEqual([
      "squeal proof: --without /etc/x: only a path in the repository or under HOME can be hidden",
    ]);
    expect(result.out).toBe("");
    clean(f);
  });
});
