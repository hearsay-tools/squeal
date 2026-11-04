import type { FixtureOptions } from "./harness.js";

/*
 * Spec 019 Testing, "Proof" (row 019-17): the fixture repository of
 * `run-triggers.test.ts`. Two Vitest projects: `unit` (`test/*.test.ts`)
 * and `e2e` (`test/e2e/**`), each e2e file importing a source the unit
 * tests import too, so one edit re-keys both groups. `flow.test.ts` sleeps
 * `DELAY_MS` from `src/delay.ts` first: a rewrite of that file makes the e2e
 * run as long as a test needs. Lint is oxlint alone, on `src/**`.
 */

/** `src/delay.ts`: how long `test/e2e/flow.test.ts` sleeps before its check. */
export const DELAY = (ms: number) => `export const DELAY_MS = ${ms};\n`;

/** `src/strings.ts` with a `debugger` statement: one oxlint finding (`no-debugger`), tests unchanged. */
export const STRINGS_LINTED = (suffix: "!" | "?" = "!") =>
  `export const shout = (s: string) => {\n  debugger;\n  return \`\${s.toUpperCase()}${suffix}\`;\n};\n`;

export const E2E_FILES = ["test/e2e/flow.test.ts", "test/e2e/sums.test.ts"] as const;
export const UNIT_FILES = ["test/math.test.ts", "test/strings.test.ts"] as const;

const FILES: Readonly<Record<string, string>> = {
  "vitest.config.ts": `export default {
  test: {
    projects: [
      { test: { name: "unit", include: ["test/*.test.ts"] } },
      { test: { name: "e2e", include: ["test/e2e/**/*.test.ts"] } },
    ],
  },
};
`,
  "src/delay.ts": DELAY(0),
  "test/e2e/flow.test.ts": `import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { DELAY_MS } from "../../src/delay.js";
import { shout } from "../../src/strings.js";

it("shouts end to end", { timeout: 600_000 }, async () => {
  await sleep(DELAY_MS);
  expect(shout("hi")).toBe("HI!");
});
`,
  "test/e2e/sums.test.ts": `import { expect, it } from "vitest";
import { add } from "../../src/math.js";

it("sums end to end", () => {
  expect([1, 2, 3].reduce(add, 0)).toBe(6);
});
`,
};

/** The three groups of 019's example, with `stop` as given. */
export const GROUPS = [
  {
    name: "e2e",
    runner: "vitest",
    project: "e2e",
    at: "stop",
    after: ["unit"],
    limits: { maxParallel: 1 },
  },
  { name: "unit", runner: "vitest", project: "unit", at: "edit" },
  { name: "lint", lint: true, at: "commit" },
] as const;

const LINT = { enabled: true, tools: ["oxlint"], include: ["src/**"] };

/** The fixture with `checks`, or without (the control: today's defaults, 019 Goal 2). */
export function triggersFixture(groups: boolean, stop: object = {}): FixtureOptions {
  return {
    files: FILES,
    policy: { lint: LINT, ...(groups ? { checks: GROUPS, stop } : {}) },
  };
}
