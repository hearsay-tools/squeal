import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refusedFlag, shardOf } from "../../../src/runners/node-test/ci-flags.js";
import { nodeTestCiRuntime } from "../../../src/runners/node-test/ci-record.js";
import { NO_REPORTER } from "../../../src/runners/node-test/ci-runs.js";
import { project, record, reporterPair, temp } from "./ci-record-kit.js";

/*
 * Spec 018 D23.4, D23.5 and D25 (row 018-47): a `node --test` process that
 * ran with a flag the daemon never runs, or named no Squeal reporter, gives
 * a part with no file and a note; the command's exit code stays its own.
 * Without `ci record`'s settings the reporter yields and writes nothing.
 */

const SLOW = { timeout: 120_000 } as const;
/** Node 22 before `--test-isolation` names it `--experimental-test-isolation` (spec 018 D25). */
const ISOLATION = process.allowedNodeEnvironmentFlags.has("--test-isolation")
  ? "--test-isolation"
  : "--experimental-test-isolation";
const FILES = {
  "squeal.config.json": '{"nodeTest":[{"name":"u","include":["*.test.mjs"]}]}\n',
  "a.test.mjs": 'import { test } from "node:test";\ntest("a", () => {});\ntest("b", () => {});\n',
};

describe("refused node:test runs", () => {
  it.each([
    [[`${ISOLATION}=none`], `${ISOLATION}=none`],
    [["--test-name-pattern=a"], "--test-name-pattern"],
    [["--test-skip-pattern", "b"], "--test-skip-pattern"],
    [["--test-only"], "--test-only"],
  ])("leaves %j out, named in the part and the output", SLOW, async (flags, named) => {
    const root = project(FILES);
    const command = [process.execPath, "--test", ...flags, ...reporterPair(), "a.test.mjs"];
    const recorded = await record(root, command);
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts).toHaveLength(1);
    const part = recorded.parts[0];
    expect(part?.testFiles).toEqual([]);
    expect(part?.header.nodeTest?.noFiles).toContain(`ran with ${named}`);
    expect(recorded.stderr).toContain(`ran with ${named}`);
  });

  it("names the missing reporter once, in each part and the output", SLOW, async () => {
    const root = project({
      ...FILES,
      "b.test.mjs": 'import { test } from "node:test";\ntest("b", () => {});\n',
    });
    const recorded = await record(root, [process.execPath, "--test", "a.test.mjs", "b.test.mjs"]);
    expect(recorded.code, recorded.stderr).toBe(0);
    expect(recorded.parts).toHaveLength(1);
    expect(recorded.parts[0]?.testFiles).toEqual([]);
    expect(recorded.parts[0]?.header.nodeTest?.noFiles).toBe(NO_REPORTER);
    expect(recorded.stderr.split(NO_REPORTER)).toHaveLength(2);
  });
});

describe("the reporter outside ci record", () => {
  it("yields and writes nothing", SLOW, () => {
    const root = project(FILES);
    const events = join(temp(), "events");
    mkdirSync(events);
    const { SQUEAL_CI_RECORD: _settings, ...env } = process.env;
    const reporter = nodeTestCiRuntime()?.reporter as string;
    const ran = spawnSync(
      process.execPath,
      ["--test", `--test-reporter=${reporter}`, "--test-reporter-destination=stdout", "a.test.mjs"],
      { cwd: root, encoding: "utf8", env },
    );
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toBe("");
    expect(readdirSync(events)).toEqual([]);
  });
});

describe("the flags of a node --test process", () => {
  it("refuses only the runs the daemon never makes", () => {
    expect(refusedFlag(["--test", "--import", "tsx"])).toBeNull();
    expect(refusedFlag(["--test-isolation=process"])).toBeNull();
    expect(refusedFlag(["--test-isolation", "none"])).toBe("--test-isolation=none");
    expect(refusedFlag(["--experimental-test-isolation=none"])).toBe(
      "--experimental-test-isolation=none",
    );
    expect(refusedFlag(["--watch"])).toBe("--watch");
  });

  it("reads the shard in both spellings", () => {
    expect(shardOf(["--test-shard=2/3"])).toEqual({ index: 2, count: 3 });
    expect(shardOf(["--test-shard", "3/3"])).toEqual({ index: 3, count: 3 });
    expect(shardOf(["--test"])).toEqual({ index: 1, count: 1 });
    expect(shardOf(["--test-shard=4/3"])).toEqual({ index: 1, count: 1 });
  });
});
