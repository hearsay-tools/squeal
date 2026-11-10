import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Part } from "../../src/core/ci/parts.js";
import { COVERAGE_RECORD_VERSION } from "../../src/core/code/coverage/record.js";
import { scratchDir } from "../ci/fixture.js";
import {
  gate,
  listing,
  onlyPart,
  partsDir,
  type Recorded,
  recorded,
  recordInto,
  SLOW,
  sameApartFromSource,
} from "./code-gate-parts-kit.js";

/*
 * Spec 020 D13.2 (row 020-08b; research `ci-evidence.md` Q3, rule 3): what
 * makes `squeal code --base --parts` run a selected file it would otherwise
 * take from the parts, and what a part's failed and skipped tests read as.
 * One `ci record` serves every case; each case reads the parts only.
 */

/** Read at run time, outside every import graph: the part's observed reads certify it. */
const READS = `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\n\nit("reads its input", () => {\n  expect(readFileSync(new URL("../data/input.txt", import.meta.url), "utf8").length).toBeGreaterThan(0);\n});\n`;

/** CC 6, which no test runs: CRAP 42, over 30, unless a skipped test may run it (D11.3). */
const RISKY = `export function risky(n: number): string {\n${[1, 2, 3, 4, 5]
  .map((n) => `  if (n === ${n}) {\n    return "${n}";\n  }\n`)
  .join("")}  return "many";\n}\n`;

const FILES: Readonly<Record<string, string>> = {
  "data/input.txt": "hello\n",
  "test/reads.test.ts": READS,
};

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

beforeAll(async () => {
  dir = scratchDir("gate-parts-cases");
  fixture = await recorded(FILES, EDITS, dir);
  part = onlyPart(fixture.parts);
}, SLOW.timeout);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("squeal code --base --parts: what the parts give (spec 020 D13.2)", () => {
  it("takes every certified file, a runtime read included", SLOW, async () => {
    const before = listing(fixture.parts);
    const ran = await gate(fixture.root, [...MATH, "--parts", fixture.parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.report.runs[0]?.from).toEqual({
      "test/add.test.ts": "parts",
      "test/grade.test.ts": "parts",
      "test/reads.test.ts": "parts",
    });
    expect(listing(fixture.parts)).toEqual(before);
  });

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
      } finally {
        writeFileSync(join(fixture.root, "test/add.test.ts"), add);
        writeFileSync(join(fixture.root, "data/input.txt"), FILES["data/input.txt"] as string);
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
  });

  it("runs a file two parts hold, and takes the rest", SLOW, async () => {
    const add = part.testFiles.filter((f) => f.path === "test/add.test.ts");
    const twice = partsDir(fixture.root, "twice", [part, { ...part, testFiles: add }]);

    const ran = await gate(fixture.root, [...MATH, "--parts", twice]);

    expect(ran.ran).toEqual(["test/add.test.ts"]);
    expect(ran.report.runs[0]?.from).toMatchObject({
      "test/add.test.ts": "run",
      "test/grade.test.ts": "parts",
    });
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

/**
 * Review 0.1.427 B1: a test whose coverage of `risky` hangs on an
 * allow-listed variable, and passes either way.
 */
const PROBE: Readonly<Record<string, string>> = {
  "squeal.config.json": JSON.stringify({
    coverage: { enabled: true, exclude: ["test/**"] },
    env: { allowlist: ["PROBE_COVER"] },
  }),
  "src/risky.ts": "export function risky(n: number): string {\n  return String(n);\n}\n",
  "test/risky.test.ts": `import { expect, it } from "vitest";\nimport { risky } from "../src/risky";\n\nit("conditional coverage", () => {\n  expect(typeof risky).toBe("function");\n  if (process.env.PROBE_COVER === "yes") for (let n = 0; n < 7; n++) risky(n);\n});\n`,
};

describe("squeal code --base --parts: the part's environment (spec 020 D13.2)", () => {
  let probe: Recorded;
  let probeDir: string;
  const crap = (g: Awaited<ReturnType<typeof gate>>) =>
    g.report.functions.map((f) => [f.qualifiedName, f.state, f.crap]);
  /** The gate with `PROBE_COVER` at `value`, for its own tests and as the command's environment. */
  const gateAt = (value: string, args: readonly string[]) => {
    vi.stubEnv("PROBE_COVER", value);
    return gate(probe.root, ["src/risky.ts", ...args], process.env);
  };

  beforeAll(async () => {
    probeDir = scratchDir("gate-parts-environment");
    vi.stubEnv("PROBE_COVER", "yes");
    try {
      probe = await recorded(PROBE, { "src/risky.ts": RISKY }, probeDir);
    } finally {
      vi.unstubAllEnvs();
    }
  }, SLOW.timeout);

  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => rmSync(probeDir, { recursive: true, force: true }));

  it("takes a file at the environment its part ran in", SLOW, async () => {
    const ran = await gateAt("yes", ["--parts", probe.parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.report.runs[0]?.from).toEqual({ "test/risky.test.ts": "parts" });
    expect([ran.code, crap(ran)]).toEqual([0, [["risky", "pass", 6]]]);
  });

  it(
    "runs a file whose allow-listed variable changed, as a gate with no parts does",
    SLOW,
    async () => {
      const fromParts = await gateAt("no", ["--parts", probe.parts]);
      const fresh = await gateAt("no", []);

      expect(fromParts.ran).toEqual(["test/risky.test.ts"]);
      expect([fromParts.code, crap(fromParts)]).toEqual([1, [["risky", "violation", 42]]]);
      expect(sameApartFromSource(fromParts.report)).toEqual(sameApartFromSource(fresh.report));
      expect(fromParts.stderr).toContain("allow-listed variables differ (values: PROBE_COVER)");
    },
  );

  it("runs a file whose part holds no descriptor of its project", SLOW, async () => {
    const bare = partsDir(probe.root, "no-descriptor", [
      { ...onlyPart(probe.parts), projects: [] },
    ]);

    const ran = await gateAt("yes", ["--parts", bare]);

    expect(ran.ran).toEqual(["test/risky.test.ts"]);
    expect([ran.code, crap(ran)]).toEqual([0, [["risky", "pass", 6]]]);
    expect(ran.stderr).toContain(`holds no environment of project ""`);
  });
});

/**
 * Review 0.1.427-r2 B1: a test whose coverage of `risky` hangs on Vitest's
 * snapshot update mode, and passes in every mode.
 */
const UPDATES: Readonly<Record<string, string>> = {
  ...PROBE,
  "squeal.config.json": JSON.stringify({ coverage: { enabled: true, exclude: ["test/**"] } }),
  "test/risky.test.ts": `import { expect, it } from "vitest";\nimport { risky } from "../src/risky";\n\nit("conditional coverage", () => {\n  expect(typeof risky).toBe("function");\n  if (expect.getState().snapshotState.snapshotUpdateState === "all") for (let n = 0; n < 7; n++) risky(n);\n});\n`,
};

describe("squeal code --base --parts: the part's snapshot update mode (018 D9, 020 D13.2)", () => {
  let none: Recorded;
  let updated: string;
  let updateDir: string;
  const crap = (g: Awaited<ReturnType<typeof gate>>) =>
    g.report.functions.map((f) => [f.qualifiedName, f.state, f.crap]);

  beforeAll(async () => {
    updateDir = scratchDir("gate-parts-update");
    none = await recorded(UPDATES, { "src/risky.ts": RISKY }, updateDir);
    updated = await recordInto(none.root, "parts-update", ["--update"]);
  }, SLOW.timeout);

  afterAll(() => rmSync(updateDir, { recursive: true, force: true }));

  it(
    "runs a file whose part ran with snapshot updates, as a gate with no parts does",
    SLOW,
    async () => {
      expect(onlyPart(updated).projects.map((p) => p.updateSnapshot)).toEqual(["all"]);

      const fromParts = await gate(none.root, ["src/risky.ts", "--parts", updated]);
      const fresh = await gate(none.root, ["src/risky.ts"]);

      expect(fromParts.ran).toEqual(["test/risky.test.ts"]);
      expect([fromParts.code, crap(fromParts)]).toEqual([1, [["risky", "violation", 42]]]);
      expect(sameApartFromSource(fromParts.report)).toEqual(sameApartFromSource(fresh.report));
      expect(fromParts.stderr).toContain('ran project "" with snapshot update "all"');
    },
  );

  it("takes a file whose part wrote no snapshot", SLOW, async () => {
    expect(onlyPart(none.parts).projects.map((p) => p.updateSnapshot)).toEqual(["none"]);

    const ran = await gate(none.root, ["src/risky.ts", "--parts", none.parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.report.runs[0]?.from).toEqual({ "test/risky.test.ts": "parts" });
    expect([ran.code, crap(ran)]).toEqual([1, [["risky", "violation", 42]]]);
  });
});
