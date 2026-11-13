import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PART_PREFIX, type Part } from "../../src/core/ci/parts.js";
import { COVERAGE_RECORD_VERSION } from "../../src/core/code/coverage/record.js";
import { scratchDir } from "../ci/fixture.js";
import {
  clearStores,
  gate,
  onlyPart,
  partsDir,
  READS,
  type Recorded,
  RISKY,
  recorded,
  SLOW,
} from "./code-gate-parts-kit.js";

/*
 * Spec 020 D13.2 (row 020-08b; research `ci-evidence.md` Q3, rule 3): what
 * makes `squeal code --base --parts` run a selected file it would otherwise
 * take from the parts, and why (row 020-49, #205), and what a part's failed
 * and skipped tests read as.
 * One `ci record` serves every case; each case reads the parts only.
 * `code-gate-parts-environment.test.ts` has the cases of a part's
 * environment and snapshot update mode.
 */

const EDITS: Readonly<Record<string, string>> = {
  "src/risky.ts": RISKY,
  "test/risky.test.ts": `import { expect, it } from "vitest";\nimport { risky } from "../src/risky";\n\nit("loads", () => expect(typeof risky).toBe("function"));\nit.skip("ones", () => expect(risky(1)).toBe("1"));\n`,
  "src/broken.ts": "export const half = (n: number) => n / 2;\n",
  "test/broken.test.ts": `import { expect, it } from "vitest";\nimport { half } from "../src/broken";\n\nit("halves", () => expect(half(4)).toBe(3));\n`,
};

const MATH = ["src/math.ts", "--test", "test/reads.test.ts"];

let fixture: Recorded;
let dir: string;
let part: Part;
/** The one part's file, as the report names it. */
let partFile: string;

beforeAll(async () => {
  dir = scratchDir("gate-parts-cases");
  fixture = await recorded(READS, EDITS, dir);
  part = onlyPart(fixture.parts);
  const name = readdirSync(fixture.parts).find((n) => n.startsWith(PART_PREFIX));
  partFile = join(fixture.parts, name ?? "");
}, SLOW.timeout);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

afterEach(() => clearStores(fixture?.root));

describe("squeal code --base --parts: what the parts give (spec 020 D13.2)", () => {
  it("reads a part's failed test as test-failed, without a run", SLOW, async () => {
    const ran = await gate(fixture.root, ["src/broken.ts", "--parts", fixture.parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.code).toBe(3);
    expect(ran.report.functions.map((f) => [f.qualifiedName, f.state, f.gap])).toEqual([
      ["half", "incomplete", "test-failed"],
    ]);
    expect(ran.report.runs[0]?.failed).toEqual([
      { path: "test/broken.test.ts", tests: ["halves"] },
    ]);
  });

  it("reads a part's skipped test as skipped, as a run does (D11.3)", SLOW, async () => {
    const fromParts = await gate(fixture.root, ["src/risky.ts", "--parts", fixture.parts]);
    const fromRun = await gate(fixture.root, ["src/risky.ts"]);

    expect(fromParts.ran).toEqual([]);
    expect(fromRun.ran).toEqual(["test/risky.test.ts"]);
    const states = (g: typeof fromRun) =>
      g.report.functions.map((f) => [f.qualifiedName, f.state, f.gap, f.crap]);
    expect(states(fromParts)).toEqual([["risky", "incomplete", "skipped", 42]]);
    expect(states(fromParts)).toEqual(states(fromRun));
  });
});

describe("squeal code --base --parts: what makes a file run (spec 020 D13.2)", () => {
  it(
    "runs a file whose input changed: a test file, or a file it read at run time",
    SLOW,
    async () => {
      const saved = (path: string) => readFileSync(join(fixture.root, path), "utf8");
      const add = saved("test/add.test.ts");
      try {
        writeFileSync(join(fixture.root, "test/add.test.ts"), `${add}// edited\n`);
        writeFileSync(join(fixture.root, "data/input.txt"), "edited\n");

        const ran = await gate(fixture.root, [...MATH, "--parts", fixture.parts]);

        expect(ran.ran).toEqual(["test/add.test.ts", "test/reads.test.ts"]);
        expect(ran.report.runs[0]?.from).toEqual({
          "test/add.test.ts": "run",
          "test/grade.test.ts": "parts",
          "test/reads.test.ts": "run",
        });
        // Row 020-49 (#205): the part and the input that differs, and one line on stderr.
        const differs = { reason: "input", detail: "its part read other content" };
        expect(ran.report.runs[0]?.refused).toEqual({
          "test/add.test.ts": { part: partFile, input: "test/add.test.ts", ...differs },
          "test/reads.test.ts": { part: partFile, input: "data/input.txt", ...differs },
        });
        expect(ran.stderr).toContain(
          "squeal code: Vitest: 2 test files not taken from the parts, 2 ran here: its part does not certify an input as it is here (test/add.test.ts: test/add.test.ts, test/reads.test.ts: data/input.txt)\n",
        );
      } finally {
        writeFileSync(join(fixture.root, "test/add.test.ts"), add);
        writeFileSync(join(fixture.root, "data/input.txt"), READS["data/input.txt"] as string);
      }
    },
  );

  it("runs every file of a part made at another record version", SLOW, async () => {
    const coverage = { ...part.header.coverage, recordVersion: COVERAGE_RECORD_VERSION + 1 };
    const other = partsDir(fixture.root, "other-version", [
      { ...part, header: { ...part.header, coverage } },
    ]);

    const ran = await gate(fixture.root, [...MATH, "--parts", other]);

    expect(ran.ran).toEqual(["test/add.test.ts", "test/grade.test.ts", "test/reads.test.ts"]);
    expect(ran.report.runs[0]?.from).toBeUndefined();
    expect(ran.stderr).toContain(
      `1 part gives no evidence, so its test files run: its records were made at provider`,
    );
    // Row 020-49: each file names its part's reason; stderr told it once, above.
    const refused = Object.values(ran.report.runs[0]?.refused ?? {});
    expect(refused.map((r) => r.reason)).toEqual(["unusable", "unusable", "unusable"]);
    expect(ran.stderr).not.toContain("not taken from the parts");
  });

  it("runs a file two parts hold, and takes the rest; then the stores give it", SLOW, async () => {
    const add = part.testFiles.filter((f) => f.path === "test/add.test.ts");
    const twice = partsDir(fixture.root, "twice", [part, { ...part, testFiles: add }]);
    const [first, second] = readdirSync(twice).sort();
    const duplicate = {
      part: join(twice, first ?? ""),
      reason: "duplicate",
      detail: `also in ${join(twice, second ?? "")}`,
    };

    const ran = await gate(fixture.root, [...MATH, "--parts", twice]);

    expect(ran.ran).toEqual(["test/add.test.ts"]);
    expect(ran.report.runs[0]?.from).toMatchObject({
      "test/add.test.ts": "run",
      "test/grade.test.ts": "parts",
    });
    expect(ran.report.runs[0]?.refused).toEqual({ "test/add.test.ts": duplicate });
    expect(ran.stderr).toContain(
      "squeal code: Vitest: 1 test file not taken from the parts, 1 ran here: more than one part holds it (test/add.test.ts)\n",
    );

    // Row 020-49 (#205): the gate kept the file it ran (D17.3); the stores give it next, still refused.
    const again = await gate(fixture.root, [...MATH, "--parts", twice]);

    expect(again.ran).toEqual([]);
    expect(again.report.runs[0]?.from?.["test/add.test.ts"]).toBe("store");
    expect(again.report.runs[0]?.refused).toEqual({ "test/add.test.ts": duplicate });
    expect(again.stderr).toContain(
      "squeal code: Vitest: 1 test file not taken from the parts, 1 read from the stores: more than one part holds it (test/add.test.ts)\n",
    );
  });

  it("runs every file of a format 3 part, which holds no record", SLOW, async () => {
    const { coverage: _header, ...header } = part.header;
    const { coverage: _records, ...rest } = part;
    const testFiles = part.testFiles.map(({ record: _r, noRecord: _n, ...file }) => file);
    const three = { ...rest, format: "squeal-ci-part/3", header, testFiles };
    const old = partsDir(fixture.root, "format-3", [three]);

    const ran = await gate(fixture.root, [...MATH, "--parts", old]);

    expect(ran.ran).toEqual(["test/add.test.ts", "test/grade.test.ts", "test/reads.test.ts"]);
    expect(ran.stderr).toContain("squeal-ci-part/3 holds no coverage record");
  });

  it("exits 2 for a parts directory with no part", SLOW, async () => {
    const empty = partsDir(fixture.root, "empty", []);

    const ran = await gate(fixture.root, [...MATH, "--parts", empty]).catch((e: Error) => e);

    expect(String(ran)).toContain(`squeal code exited 2: squeal code: no part`);
  });
});
