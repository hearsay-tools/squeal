import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Part, readPart } from "../../../src/core/ci/parts.js";
import { ci, cloneOf, committed, scratch, VITEST } from "../../ci/fixture.js";
import {
  nodeTestCommand,
  project,
  record,
  reporterPair,
  TEST_FILES,
  withoutNodeOptions,
} from "./ci-record-kit.js";

/*
 * Row 018-60 (review of 0.1.580 S1): the nested-run markers node:test's CI
 * hook sets in a test's process (`SQUEAL_CI_NODE_TEST_FILE`,
 * `SQUEAL_CI_NODE_TEST_PROCESS`) never survive a recording's boundary. A
 * stale one in the CI job's own environment would read every process of the
 * recorded command as nested, so no part would be written; and a test that
 * starts another `ci record` gets that recording its own, while the outer
 * command's evidence stays withheld for it (D9, review of 018-23 B2). The
 * `NODE_TEST_CONTEXT` the outer test's process set stays in an inner command's
 * env too (row 018-68): no process of it is a test file's process, so no inner
 * recording leaves an empty node:test part or a "names no Squeal reporter"
 * line for a run that never was.
 */

const SLOW = { timeout: 300_000 } as const;

/** The CLI a test of the recorded command starts, as a user's `squeal` binary. */
const CLI = join(resolve(import.meta.dirname, "../../.."), "src/cli/index.ts");

/** The CI job's own environment: both markers left by an earlier recording. */
const stale = (file: string): NodeJS.ProcessEnv => ({
  ...withoutNodeOptions(),
  CI: "true",
  SQUEAL_CI_NODE_TEST_FILE: file,
  SQUEAL_CI_NODE_TEST_PROCESS: "1",
});

/** The parts in `out`, none when it was never written. */
function partsIn(out: string): Part[] {
  return readdirSync(out)
    .sort()
    .map((name) => {
      const part = readPart(join(out, name));
      if (typeof part === "string") throw new Error(part);
      return part;
    });
}

/** One plain test file per runner, both recorded by one command. */
function bothFixture(): string {
  return committed(scratch("ci-inherited-marker"), {
    "package.json": JSON.stringify({ name: "ci-inherited-marker", private: true, type: "module" }),
    "squeal.config.json": '{"nodeTest":[{"name":"unit","include":["node/*.test.mjs"]}]}\n',
    "vitest.config.ts": `export default { test: { include: ["vt/**/*.test.ts"] } }\n`,
    "lib/a.mjs": "export const a = 1;\n",
    "vt/plain.test.ts": `import { expect, it } from "vitest";\nimport { a } from "../lib/a.mjs";\nit("a", () => expect(a).toBe(1));\n`,
    "node/plain.test.mjs": `import { test } from "node:test";\nimport { a } from "../lib/a.mjs";\ntest("a", () => { if (a !== 1) throw new Error("a"); });\n`,
  });
}

/** A node:test test that starts other `squeal ci record`s: around a Vitest run and a `node --test`. */
function innerFixture(): string {
  return committed(scratch("ci-inner-record"), {
    "package.json": JSON.stringify({ name: "ci-inner-record", private: true, type: "module" }),
    "squeal.config.json": '{"nodeTest":[{"name":"unit","include":["node/*.test.mjs"]}]}\n',
    "vitest.config.ts": `export default { test: { include: ["vt/**/*.test.ts"] } }\n`,
    "vt/plain.test.ts": `import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n`,
    "inner/plain.test.mjs": `import { test } from "node:test";\ntest("inside a test", () => {});\n`,
    "node/starts-record.test.mjs": `import { spawnSync } from "node:child_process";
import { test } from "node:test";
const record = (out, command) => {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", ${JSON.stringify(CLI)}, "ci", "record", "--out", out, "--", ...command],
    { encoding: "utf8" },
  );
  console.error(run.stderr);
  if (run.status !== 0) throw new Error(run.stderr);
};
test("starts a ci record around vitest run", () => {
  record("inner-parts", [process.execPath, ${JSON.stringify(VITEST)}, "run", "vt/plain.test.ts"]);
});
test("starts a ci record around node --test", () => {
  record("inner-node-parts", [
    process.execPath,
    "--test",
    ...${JSON.stringify(reporterPair())},
    "inner/plain.test.mjs",
  ]);
});
`,
  });
}

describe("squeal ci record below a stale node:test marker (row 018-60)", () => {
  it(
    "records the part with both markers set in the CI job's own env (node:test alone)",
    SLOW,
    async () => {
      const root = project();
      const command = nodeTestCommand(process.execPath, [...reporterPair(), ...TEST_FILES]);
      const recorded = await record(root, command, stale(join(root, "test/esm.test.mjs")));
      expect(recorded.code, recorded.stderr).toBe(0);
      expect(recorded.parts, recorded.stderr).toHaveLength(1);
      const part = recorded.parts[0];
      if (part === undefined) throw new Error("no part");
      expect(part.header.runner).toBe("node-test");
      expect(part.testFiles.map((f) => f.path)).toEqual(TEST_FILES);
    },
  );

  it(
    "records both runners' parts with both markers set in the CI job's own env",
    SLOW,
    async () => {
      const origin = bothFixture();
      const out = join(dirname(origin), "parts");
      const pair = reporterPair()
        .map((arg) => `'${arg}'`)
        .join(" ");
      const command = [
        "sh",
        "-c",
        `"$0" ${JSON.stringify(VITEST)} run && "$0" --test --test-reporter=spec --test-reporter-destination=stdout ${pair} node/plain.test.mjs`,
        process.execPath,
      ];
      const recorded = await ci(
        ["record", "--out", out, "--", ...command],
        origin,
        stale(join(origin, "node/plain.test.mjs")),
      );
      expect(recorded.code, recorded.said).toBe(0);
      expect(recorded.said).not.toContain("nothing recorded");
      expect(
        partsIn(out).map((p) => [p.header.runner, p.testFiles.map((f) => f.path)]),
        recorded.said,
      ).toEqual(
        expect.arrayContaining([
          ["vitest", ["vt/plain.test.ts"]],
          ["node-test", ["node/plain.test.mjs"]],
        ]),
      );
      expect(partsIn(out), recorded.said).toHaveLength(2);

      const root = cloneOf(origin, "export");
      const file = join(dirname(origin), "results.json.gz");
      const exported = await ci(
        ["export", "--parts", out, "--out", file],
        root,
        stale(join(root, "node/plain.test.mjs")),
      );
      expect(exported.code, exported.said).toBe(0);
      expect(exported.said).not.toContain("Left out");
      expect(exported.said).toMatch(/Exported 2 test files, \d+ results/);
    },
  );

  it(
    "records the parts of a ci record a test starts, and withholds the outer file",
    SLOW,
    async () => {
      const origin = innerFixture();
      const out = join(dirname(origin), "parts");
      const pair = reporterPair()
        .map((arg) => `'${arg}'`)
        .join(" ");
      const command = [
        "sh",
        "-c",
        `"$0" ${JSON.stringify(VITEST)} run && "$0" --test --test-reporter=spec --test-reporter-destination=stdout ${pair} node/starts-record.test.mjs`,
        process.execPath,
      ];
      const recorded = await ci(["record", "--out", out, "--", ...command], origin, {
        ...withoutNodeOptions(),
        CI: "true",
      });
      expect(recorded.code, recorded.said).toBe(0);
      // The inner recording is its own: the test's markers never reach its
      // command, so its Vitest run is a part (before row 018-60, the stale
      // marker read every process of it as nested and nothing was written).
      // The inherited `NODE_TEST_CONTEXT` (Node's own, which the outer test's
      // process set) stays in its command's env, so Node itself skips an inner
      // `node --test`, and no process of the command is a test file's process
      // (row 018-68): neither inner recording leaves an empty node:test part
      // or a "names no Squeal reporter" line for a run that never was.
      expect(
        partsIn(join(origin, "inner-parts")).map((p) => [
          p.header.runner,
          p.testFiles.map((f) => f.path),
        ]),
        recorded.said,
      ).toEqual([["vitest", ["vt/plain.test.ts"]]]);
      const innerNode = join(origin, "inner-node-parts");
      const skippedParts = existsSync(innerNode) ? partsIn(innerNode) : [];
      expect(skippedParts, recorded.said).toEqual([]);
      expect(recorded.said).not.toContain("names no Squeal reporter");
      expect(
        partsIn(out).map((p) => [p.header.runner, p.testFiles.map((f) => f.path)]),
        recorded.said,
      ).toEqual(
        expect.arrayContaining([
          ["vitest", ["vt/plain.test.ts"]],
          ["node-test", ["node/starts-record.test.mjs"]],
        ]),
      );
      expect(partsIn(out), recorded.said).toHaveLength(2);

      // Another recording's writes never count as the outer command's
      // evidence: the withholding is the recording's, not one file's (review
      // of 018-23 B2), so every file of it stays left out and nothing exports.
      const exported = await ci(
        ["export", "--parts", out, "--out", join(dirname(origin), "results.json.gz")],
        cloneOf(origin, "export"),
      );
      const said = exported.said;
      expect(exported.code, said).toBe(1);
      expect(said).toContain("left out unit:node/starts-record.test.mjs");
      expect(said).toContain("left out vt/plain.test.ts");
      expect(said).toContain("no test file to export");
    },
  );
});
