import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countFile } from "../../src/core/code/count/index.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { type ExceptionEntry, QUALITY_POLICY_VERSION } from "../../src/core/code/gate/types.js";
import { git } from "../hash/git-repo.js";
import { BASE, code, edit, noEstimate, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D8 (row 020-09): `squeal code --base <ref> --exceptions <file>`
 * end to end, in a temporary git repository with no daemon, and the text
 * lines of exceptions. The file is the consumer's: Squeal applies it and
 * keeps the measured scores.
 */

/** `deep` with `ifs` decisions: CC `ifs + 1`. A test calls it with 100, so every line runs. */
const deep = (ifs: number, tail = "n") => `export function deep(x: number): number {
  let n = 0;
${Array.from({ length: ifs }, (_, i) => `  if (x > ${i}) n++;`).join("\n")}
  return ${tail};
}
`;

/** The base: `double` and `deep` at CC 21, over the limit of 20, both tested. */
const OVER_AT_BASE: Readonly<Record<string, string>> = {
  ...BASE,
  "src/math.ts": `${BASE["src/math.ts"]}\n${deep(20)}`,
  "test/math.test.ts": `import { expect, it } from "vitest";\nimport { deep, double } from "../src/math";\n\nit("doubles", () => expect(double(2)).toBe(4));\nit("counts", () => expect(deep(100)).toBe(20));\n`,
};

/**
 * Writes the head's `src/math.ts`, and an exceptions file naming its `deep`
 * at the merge base under `.git/`, which git does not list as a change.
 */
async function headWithException(
  root: string,
  text: string,
  over: Partial<ExceptionEntry>,
): Promise<string> {
  edit(root, { "src/math.ts": text });
  const count = await countFile(text, "typescript");
  const bodyHash = count.functions.find((f) => f.qualifiedName === "deep")?.bodyHash;
  const file = join(root, ".git", "exceptions.json");
  const entry = {
    path: "src/math.ts",
    qualifiedName: "deep",
    bodyHash,
    measure: "complexity",
    kind: "inherited",
    value: 21,
    issue: "https://github.com/o/r/issues/167",
    approver: "owner",
    baseCommit: git(root, ["rev-parse", "main"]).trim(),
    ...over,
  };
  writeFileSync(file, JSON.stringify({ format: "squeal-code-exceptions/1", entries: [entry] }));
  return file;
}

const functionsOf = (stdout: string) =>
  (JSON.parse(stdout) as GateReport).functions.map((f) => [
    f.qualifiedName,
    f.complexity,
    f.crap,
    f.state,
    f.exceptions?.map((u) => [u.outcome, u.baseComplexity]),
  ]);

describe("squeal code --base --exceptions (spec 020 D8)", () => {
  it("exits 0 when an inherited CC exception covers a function not made worse", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(OVER_AT_BASE);
    const file = await headWithException(root, `${BASE["src/math.ts"]}\n${deep(20, "n + 0")}`, {});

    const ran = await code(root, ["--base", "main", "--exceptions", file, "--json"]);

    expect(ran.stderr).toBe(
      `squeal code: Vitest: 1 test file to run (tests 1)\n${noEstimate("Vitest", 1)}`,
    );
    expect(ran.code).toBe(0);
    expect(functionsOf(ran.stdout)).toEqual([["deep", 21, 21, "accepted", [["covers", 21]]]]);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect([report.verdict, report.counts.accepted, report.exceptions]).toEqual([
      "pass",
      1,
      { unused: [] },
    ]);
    expect(report.versions.qualityPolicy).toBe(QUALITY_POLICY_VERSION);
  });

  it("exits 1 when the function got worse than at the base", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(OVER_AT_BASE);
    const file = await headWithException(root, `${BASE["src/math.ts"]}\n${deep(21)}`, {
      value: 22,
    });

    const ran = await code(root, ["--base", "main", "--exceptions", file]);

    expect(ran.code).toBe(1);
    expect(ran.stdout.split("\n").slice(0, 2)).toEqual([
      expect.stringMatching(
        /^Code gate: violations\. 1 changed function against main .*: 1 violation\.$/,
      ),
      "  src/math.ts:5  deep  CC 22 over 20, coverage 100%, CRAP 22: violation; inherited complexity exception does not cover it: CC is over the base's 21",
    ]);
  });

  it.each([
    ["{ not json", /: not JSON: /],
    [
      `{"format":"squeal-code-exceptions/2","entries":[]}`,
      /: format is "squeal-code-exceptions\/2", not "squeal-code-exceptions\/1"$/,
    ],
    [
      `{"format":"squeal-code-exceptions/1","entries":[{"path":"a.ts"}]}`,
      /: entry 1: qualifiedName is not a non-empty string$/,
    ],
  ])(
    "exits 2 for a file that is not an exceptions file, and runs nothing: %s",
    SLOW,
    async (text, error) => {
      const leftInTmp = ownHomeAndTmp();
      const root = repo();
      const file = join(root, ".git", "bad.json");
      writeFileSync(file, text);

      const ran = await code(root, ["--base", "main", "--exceptions", file]);

      expect([ran.code, ran.stdout]).toEqual([2, ""]);
      expect(ran.stderr.trimEnd()).toMatch(error);
      expect(ran.stderr).toContain(`squeal code: --exceptions ${file}`);
      expect(leftInTmp()).toEqual([]);
    },
  );

  it("exits 2 for an exceptions file that does not exist", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo();
    const ran = await code(root, ["--base", "main", "--exceptions", "nope.json"]);
    expect(ran).toEqual({
      code: 2,
      stdout: "",
      stderr: "squeal code: --exceptions nope.json: cannot be read: ENOENT\n",
    });
  });
});
