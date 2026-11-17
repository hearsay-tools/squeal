import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { parseProof } from "../../src/cli/proof-args.js";

/*
 * Row 023-08: `squeal proof`'s arguments. Row 023-11's options (`--env`,
 * `--without`, `--repeat`, `--case dependency`) exit 2 with one line that
 * names them as not built yet.
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
    });
    expect(parseProof(["a.test.ts", "--base=main"])).toMatchObject({
      case: null,
      timeoutSeconds: 600,
      json: false,
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
  ])("refuses %j: %s", (args, usage) => {
    expect(parseProof(args)).toEqual({ usage });
  });

  it.each([
    [["--env", "HOME="], "--env"],
    [["--env=TZ=UTC"], "--env"],
    [["--without", "fixtures"], "--without"],
    [["--repeat", "5"], "--repeat"],
    [["--case", "dependency"], "--case dependency"],
  ])("exits 2 on row 023-11's %j with one line", async (extra, what) => {
    const { code, err } = await cli(["test/a.test.ts", "--base", "HEAD", ...extra]);
    expect(code).toBe(2);
    expect(err.trim().split("\n")).toHaveLength(1);
    expect(err).toContain(`squeal proof: ${what}`);
    expect(err).toContain("row 023-11's behaviour and is not built yet");
  });

  it("prints usage with the help on any other usage error", async () => {
    const { code, err } = await cli(["test/a.test.ts"]);
    expect(code).toBe(2);
    expect(err).toContain("squeal proof: --base needs a commit");
    expect(err).toContain("squeal proof <test file>... --base <commit>");
  });
});
