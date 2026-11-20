import { describe, expect, it } from "vitest";
import { configFieldHash } from "../../../src/core/keys/environment-descriptor.js";
import { exportParts, project, record, reporterPair, withoutNodeOptions } from "./ci-record-kit.js";

/*
 * Review of 0.1.579 B2 (spec 018 D1, D9, D26.3): the policy's
 * `env.allowlist` is keyed for node:test too, so `ci record` records each
 * allow-listed variable as the test saw it, and `ci export` keys a file
 * only when that is the value its own environment gives the keys. Another
 * value leaves out that entry and keeps the rest; an entry's own `env`
 * overrides the allowlist, as the test's process sees it. Values are never
 * printed.
 */

const SLOW = { timeout: 120_000 } as const;

function files(unit: Record<string, unknown>) {
  return {
    "squeal.config.json": `${JSON.stringify({
      env: { allowlist: ["MODE"] },
      nodeTest: [
        { name: "unit", include: ["a.test.mjs"], ...unit },
        // Its own flag: which entry a process is, apart from B4's ownership by file.
        { name: "other", argv: ["--no-warnings"], include: ["b.test.mjs"] },
      ],
    })}\n`,
    "a.test.mjs": [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("mode", () => assert.equal(process.env.MODE, "ci"));',
      "",
    ].join("\n"),
    "b.test.mjs": 'import { test } from "node:test";\ntest("b", () => {});\n',
  };
}

const quote = (args: readonly string[]) => args.map((a) => `'${a}'`).join(" ");
const nodeTest = (file: string, ...flags: string[]) =>
  quote([process.execPath, ...flags, "--test", ...reporterPair(), file]);
const b = nodeTest("b.test.mjs", "--no-warnings");
const both = ["sh", "-c", `${nodeTest("a.test.mjs")} && ${b}`];
/** As `both`, with `b.test.mjs` run under `MODE=local`. */
const apart = ["sh", "-c", `${nodeTest("a.test.mjs")} && MODE=local ${b}`];
const env = (mode: string) => ({ ...withoutNodeOptions(), MODE: mode });

describe("allow-listed variables of a recorded node:test run (review of 0.1.579 B2)", () => {
  it(
    "records them, and exports only where this job's value is the recorded one",
    SLOW,
    async () => {
      const root = project(files({}));
      const recorded = await record(root, apart, env("ci"));
      expect(recorded.code, recorded.stderr).toBe(0);
      const modes = recorded.parts.map((part) => part.header.nodeTest?.env?.MODE).sort();
      expect(modes).toEqual([configFieldHash("ci"), configFieldHash("local")].sort());

      const local = await exportParts(root, recorded.out, env("local"));
      expect(local.code, local.stderr).toBe(0);
      expect(local.stdout).toContain("Exported 1 test file, 2 results");
      expect(local.stderr).toContain(
        `node:test of project "unit" ran with another value of MODE than this job's environment`,
      );

      const same = await exportParts(root, recorded.out, env("ci"));
      expect(same.code, same.stderr).toBe(0);
      expect(same.stdout).toContain("Exported 1 test file, 2 results");
      expect(same.stderr).toContain(`node:test of project "other" ran with another value of MODE`);
    },
  );

  it("compares an entry's own env value, not this job's, for a name it sets", SLOW, async () => {
    const root = project(files({ env: { MODE: "ci" } }));
    const recorded = await record(root, both, env("ci"));
    expect(recorded.code, recorded.stderr).toBe(0);
    const exported = await exportParts(root, recorded.out, env("other"));
    expect(exported.code, exported.stderr).toBe(0);
    expect(exported.stderr).toContain(
      `node:test of project "other" ran with another value of MODE than this job's environment`,
    );
    expect(exported.stdout).toContain("Exported 1 test file, 2 results");
  });
});
