import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PART_PREFIX } from "../../src/core/ci/parts.js";
import { scratchDir } from "../ci/fixture.js";
import {
  clearStores,
  gate,
  onlyPart,
  partsDir,
  type Recorded,
  recorded,
  SLOW,
} from "./code-gate-parts-kit.js";

/*
 * Review 0.1.465 B1 (row 020-49, #205): a file the parts refuse that the
 * gate then never starts reads "did not run" on stderr, never "ran here".
 * The config spends the one-second budget before any local test starts,
 * in `ci record`'s run and in the gate's alike, so only the part's
 * accepted file has evidence.
 */

/** A Vitest config that takes 1.5 s to load: past a `--timeout 1` budget before the first run. */
const SLOW_START = `import { defineConfig } from "vitest/config";\nexport default async () => {\n  await new Promise((resolve) => setTimeout(resolve, 1500));\n  return defineConfig({ test: { include: ["test/**/*.test.ts"], maxWorkers: 1 } });\n};\n`;

let fixture: Recorded;
let dir: string;

beforeAll(async () => {
  dir = scratchDir("gate-parts-unstarted");
  fixture = await recorded({ "vitest.config.ts": SLOW_START }, {}, dir);
}, SLOW.timeout);

afterAll(() => {
  clearStores(fixture?.root);
  rmSync(dir, { recursive: true, force: true });
});

describe("squeal code --base --parts: a refused file the budget never reached (review 0.1.465 B1)", () => {
  it("says it did not run, and the verdict stays incomplete", SLOW, async () => {
    const part = onlyPart(fixture.parts);
    const zero = "0".repeat(40);
    const evidence = { ...part.evidence, "test/grade.test.ts": zero };
    const mismatched = partsDir(fixture.root, "mismatched", [{ ...part, evidence }]);

    const ran = await gate(fixture.root, ["--timeout", "1", "--parts", mismatched]);

    expect(ran.code).toBe(3);
    expect(ran.report.verdict).toBe("incomplete");
    const [vitest] = ran.report.runs;
    expect(vitest?.completed).toEqual(["test/add.test.ts"]);
    expect(vitest?.notStarted).toEqual(["test/grade.test.ts"]);
    expect(vitest?.from).toEqual({ "test/add.test.ts": "parts", "test/grade.test.ts": "run" });
    expect(vitest?.refused?.["test/grade.test.ts"]).toMatchObject({
      part: expect.stringContaining(PART_PREFIX),
      reason: "input",
      input: "test/grade.test.ts",
    });
    expect(ran.stderr).toContain(
      "squeal code: Vitest: 1 test file not taken from the parts, 1 did not run: its part does not certify an input as it is here (test/grade.test.ts: test/grade.test.ts)\n",
    );
    expect(ran.stderr).not.toContain("ran here");
  });
});
