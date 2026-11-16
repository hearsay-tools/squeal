import { afterEach, describe, expect, it } from "vitest";
import { type GateFilesResult, runGateFiles } from "../../src/cli/code-gate-files.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import { quiet } from "../code/gate/host-load.js";
import { BASE, ownHomeAndTmp, repo } from "./code-gate-fixture.js";

/*
 * Review wave 1 B2 (row 023-04, spec 023 D4.4, D5.3): `runGateFiles` runs
 * Vitest and node:test under the environment its stores key with. An
 * allow-listed variable the call overrides and one it unsets reach both
 * runners; the result is stored at that environment's key, so a later
 * call whose process has that environment reads it, and one whose process
 * differs runs again (the review's store-reuse probe, both ways). A
 * variable outside the allow-list is a condition: the call runs it only
 * with `store: false`, and stores nothing.
 */

const WANTED = 'process.env.REVIEW_023_ENV === "wanted" && !("GATE_UNSET" in process.env)';
const CONDITION = 'process.env.GATE_CONDITION === "on"';

const vitestFile = (check: string) =>
  `import { expect, it } from "vitest";\n\nit("sees the call's environment", () => expect(${check}).toBe(true));\n`;
const nodeFile = (check: string) =>
  `import assert from "node:assert/strict";\nimport test from "node:test";\n\ntest("sees the call's environment", () => assert.equal(${check}, true));\n`;

const CONFIG = {
  env: { allowlist: ["REVIEW_023_ENV", "GATE_UNSET"] },
  nodeTest: [{ name: "t", include: ["test/*.test.mjs"] }],
};

const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  "squeal.config.json": `${JSON.stringify(CONFIG)}\n`,
  "test/env.test.ts": vitestFile(WANTED),
  "test/env.test.mjs": nodeFile(WANTED),
  "test/condition.test.ts": vitestFile(CONDITION),
  "test/condition.test.mjs": nodeFile(CONDITION),
};

const NAMES = ["REVIEW_023_ENV", "GATE_UNSET", "GATE_CONDITION"] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of NAMES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** Each file's path, outcome and origin. */
const outcomes = (result: GateFilesResult) => result.runs.map((r) => [r.path, r.outcome, r.from]);

const SLOW = { timeout: 300_000 } as const;

describe("runGateFiles runs both runners under its one environment (review wave 1 B2)", () => {
  it(
    "overrides and unsets a variable for both runners and stores at that environment's key",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(FILES) as AbsolutePath;
      const files = ["test/env.test.ts", "test/env.test.mjs"] as RelativePath[];
      const call = { root, files, budgetSeconds: 120, hostLoad: quiet };
      process.env.REVIEW_023_ENV = "actual";
      process.env.GATE_UNSET = "present";
      const env: NodeJS.ProcessEnv = { ...process.env, REVIEW_023_ENV: "wanted" };
      delete env.GATE_UNSET;

      expect(outcomes(await runGateFiles({ ...call, env }))).toEqual([
        ["test/env.test.ts", "passed", "run"],
        ["test/env.test.mjs", "passed", "run"],
      ]);
      expect([process.env.REVIEW_023_ENV, process.env.GATE_UNSET]).toEqual(["actual", "present"]);

      // The review's probe: the process now has the call's environment, so the stores give its result.
      process.env.REVIEW_023_ENV = "wanted";
      delete process.env.GATE_UNSET;
      expect(outcomes(await runGateFiles(call))).toEqual([
        ["test/env.test.ts", "passed", "store"],
        ["test/env.test.mjs", "passed", "store"],
      ]);

      // Its inverse: the process's own environment is another key, so the files run, and fail.
      process.env.REVIEW_023_ENV = "actual";
      process.env.GATE_UNSET = "present";
      expect(outcomes(await runGateFiles(call))).toEqual([
        ["test/env.test.ts", "failed", "run"],
        ["test/env.test.mjs", "failed", "run"],
      ]);
    },
  );

  it(
    "runs a condition outside the key only with store: false, and stores nothing of it",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(FILES) as AbsolutePath;
      const files = ["test/condition.test.ts", "test/condition.test.mjs"] as RelativePath[];
      const call = { root, files, budgetSeconds: 120, hostLoad: quiet };
      delete process.env.GATE_CONDITION;
      const env = { ...process.env, GATE_CONDITION: "on" };

      await expect(runGateFiles({ ...call, env })).rejects.toThrow(/GATE_CONDITION .*store: false/);
      expect(outcomes(await runGateFiles({ ...call, env, store: false }))).toEqual([
        ["test/condition.test.ts", "passed", "run"],
        ["test/condition.test.mjs", "passed", "run"],
      ]);
      expect("GATE_CONDITION" in process.env).toBe(false);

      // Nothing was stored at the key the condition does not change: the files run again, and fail.
      expect(outcomes(await runGateFiles(call))).toEqual([
        ["test/condition.test.ts", "failed", "run"],
        ["test/condition.test.mjs", "failed", "run"],
      ]);
    },
  );
});
