import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { parseProof } from "../../src/cli/proof-args.js";

/*
 * Rows 023-08, 023-11: `squeal proof`'s arguments, the conditions
 * (`--env`, `--without`), `--repeat` and `--case dependency` among them.
 */

async function cli(args: readonly string[]) {
  const err: string[] = [];
  const code = await main(["proof", ...args], {
    stdout: () => {},
    stderr: (text) => err.push(text),
    cwd: process.cwd(),
  });
  return { code, err: err.join("") };
}

describe("squeal proof arguments (row 023-08)", () => {
  it("reads the files, the base, the case, the budget and --json", () => {
    expect(
      parseProof([
        "test/a.test.ts",
        "--base",
        "HEAD~1",
        "--case=test",
        "--timeout",
        "90",
        "--json",
      ]),
    ).toEqual({
      files: ["test/a.test.ts"],
      base: "HEAD~1",
      case: "test",
      timeoutSeconds: 90,
      json: true,
      env: [],
      without: [],
      homeKeep: [],
      with: [],
      repeat: 1,
    });
    expect(parseProof(["a.test.ts", "--base=main"])).toMatchObject({
      case: null,
      timeoutSeconds: 600,
      json: false,
    });
  });

  it("reads --with, repeatable (row 023-21)", () => {
    expect(
      parseProof(["a.test.ts", "--base", "main", "--with", "src/a.testkit.ts", "--with=b.ts"]),
    ).toMatchObject({ files: ["a.test.ts"], with: ["src/a.testkit.ts", "b.ts"] });
    expect(parseProof(["a.test.ts", "--base", "main", "--with"])).toEqual({
      usage: "--with needs a value",
    });
  });

  it.each([
    [["a.test.ts"], "--base needs a commit"],
    [["--base", "main"], "name at least one test file"],
    [["a.test.ts", "--base", "main", "--case", "other"], "--case takes source, dependency or test"],
    [["a.test.ts", "--base", "main", "--timeout", "0"], "--timeout takes whole seconds above 0"],
    [["a.test.ts", "--base", "main", "--base", "x"], "--base is given twice"],
    [["a.test.ts", "--base"], "--base needs a value"],
    [["a.test.ts", "--base", "main", "--all"], 'unknown option "--all"'],
    [
      ["a.test.ts", "--base", "main", "--repeat", "0"],
      "--repeat takes a whole number from 1 to 100",
    ],
    [
      ["a.test.ts", "--base", "main", "--repeat", "101"],
      "--repeat takes a whole number from 1 to 100",
    ],
    [
      ["a.test.ts", "--base", "main", "--repeat", "2.5"],
      "--repeat takes a whole number from 1 to 100",
    ],
    [["a.test.ts", "--base", "main", "--repeat", "2", "--repeat", "3"], "--repeat is given twice"],
    [
      ["a.test.ts", "--base", "main", "--env", "TZ"],
      '--env takes NAME=value, or NAME= to unset it; not "TZ"',
    ],
    [
      ["a.test.ts", "--base", "main", "--env", "1X=a"],
      '--env takes NAME=value, or NAME= to unset it; not "1X=a"',
    ],
    [["a.test.ts", "--base", "main", "--env", "A=", "--env", "A=b"], "--env A is given twice"],
    [
      ["a.test.ts", "--base", "main", "--case", "dependency"],
      "--case dependency needs a condition: --env NAME=[value] or --without <path>",
    ],
  ])("refuses %j: %s", (args, usage) => {
    expect(parseProof(args)).toEqual({ usage });
  });

  it("reads the conditions, each repeatable, and --repeat (row 023-11)", () => {
    expect(
      parseProof([
        "a.test.ts",
        "--base=main",
        "--case",
        "dependency",
        "--env",
        "CI=",
        "--env=TZ=Europe/Warsaw",
        "--env",
        "EQ=a=b",
        "--without",
        "~/.npmrc",
        "--without=fixtures/local",
        "--home-keep",
        "~/.gitconfig",
        "--home-keep=~/.config/tool",
        "--repeat",
        "5",
      ]),
    ).toMatchObject({
      case: "dependency",
      env: [
        { name: "CI", value: null },
        { name: "TZ", value: "Europe/Warsaw" },
        { name: "EQ", value: "a=b" },
      ],
      without: ["~/.npmrc", "fixtures/local"],
      homeKeep: ["~/.gitconfig", "~/.config/tool"],
      repeat: 5,
    });
  });

  it.each([
    [["--case", "dependency"], "--case dependency needs a condition"],
    [["--repeat", "0"], "--repeat takes a whole number from 1 to 100"],
  ])("exits 2 on %j", async (extra, what) => {
    const { code, err } = await cli(["test/a.test.ts", "--base", "HEAD", ...extra]);
    expect(code).toBe(2);
    expect(err).toContain(`squeal proof: ${what}`);
  });

  it("prints usage with the help on any other usage error", async () => {
    const { code, err } = await cli(["test/a.test.ts"]);
    expect(code).toBe(2);
    expect(err).toContain("squeal proof: --base needs a commit");
    expect(err).toContain("squeal proof <test file>... --base <commit>");
  });
});
