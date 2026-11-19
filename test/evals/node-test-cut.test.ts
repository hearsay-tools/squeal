import { describe, expect, it } from "vitest";
import { completedRuns } from "../../evals/lib/index.mjs";

/*
 * Row 005-128 (findings `start-message-experiment.md`, "`a5-uncovered` on Sonnet"): a node:test
 * run piped through `| tail` loses its summary down to `todo` and `duration_ms`, yet still shows
 * the failing test's own line. Both shapes are kept transcripts of run 20261119T001551Z-264cf1,
 * where `own-run-covers` read them as not completed.
 */

const FAILURE = [
  "test at scripts/changelog.test.mjs:5:1",
  "✖ groups entries by type in first-seen order (1.384256ms)",
  "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
  "  + actual - expected",
  "      at TestContext.<anonymous> (file://<cell>/work/scripts/changelog.test.mjs:11:10)",
  "    operator: 'strictEqual',",
  "  }",
];
/** `node --test scripts/changelog.test.mjs 2>&1 | tail -25`. */
const NODE_TAIL = ["ℹ todo 0", "ℹ duration_ms 103.144171", "", "✖ failing tests:", "", ...FAILURE];
/** `npm run test:scripts 2>&1 | tail -30`: npm's notice takes the last lines. */
const NPM_TAIL = [
  ...NODE_TAIL,
  "npm notice",
  "npm notice New major version of npm available! 11.20.0 -> 12.2.3",
  "npm notice",
];
/** The same run whole. */
const WHOLE = [
  "✖ groups entries by type in first-seen order (1.517997ms)",
  "✔ labels an unknown type as Changed (0.193385ms)",
  "ℹ tests 2",
  "ℹ suites 0",
  "ℹ pass 1",
  "ℹ fail 1",
  "ℹ cancelled 0",
  "ℹ skipped 0",
  "ℹ todo 0",
  "ℹ duration_ms 89.1732",
  "",
  "✖ failing tests:",
  "",
  ...FAILURE,
];

const nodeTest = (lines: readonly string[]) => completedRuns(lines.join("\n"))["node:test"];

describe("a node:test run cut by `| tail` (row 005-128)", () => {
  it("is completed when the kept output shows a test that failed", () => {
    expect(nodeTest(NODE_TAIL)).toBe(1);
    expect(nodeTest(NPM_TAIL)).toBe(1);
  });

  it("is completed when it shows a test that passed, in spec or TAP form", () => {
    expect(nodeTest(["ℹ duration_ms 3", "✔ adds (0.2ms)"])).toBe(1);
    expect(nodeTest(["# duration_ms 3", "ok 1 - adds", "not ok 2 - subtracts"])).toBe(1);
  });

  it("counts the whole run once, by its summary", () => {
    expect(nodeTest(WHOLE)).toBe(1);
  });

  it("is not completed with only skipped or todo tests, or no test line", () => {
    expect(nodeTest(["ℹ duration_ms 3", "﹣ adds (0.2ms) # SKIP"])).toBe(0);
    expect(nodeTest(["ℹ duration_ms 3", "✔ adds (0.2ms) # TODO"])).toBe(0);
    expect(nodeTest(["ok 1 - adds # SKIP", "ok 2 - subtracts # TODO not yet"])).toBe(0);
    expect(nodeTest(["ℹ todo 0", "ℹ duration_ms 3", "", "✖ failing tests:", ""])).toBe(0);
    expect(nodeTest(["Could not find '/w/scripts/none.test.mjs'"])).toBe(0);
  });

  it("leaves Vitest's own test lines to Vitest", () => {
    expect(nodeTest([" ✓ test/a.test.ts > adds 1ms", " × test/a.test.ts > subtracts 2ms"])).toBe(0);
  });
});
