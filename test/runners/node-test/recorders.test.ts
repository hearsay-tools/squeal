import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/index.js";
import {
  isSquealRecorder,
  projectEnv,
  withoutSquealRecorders,
} from "../../../src/runners/node-test/recorders.js";

/**
 * Task 003-35: under a Squeal daemon a test process inherits 001-132's
 * recorder in `NODE_OPTIONS` and its settings in `SQUEAL_OBSERVE`. Neither is
 * the project's: the node:test runner keys and runs a project as a plain
 * shell would, and a project's own `--require` still counts.
 */

const PLUGIN = "/home/u/.claude/plugins/cache/squeal/squeal/0.1.40/dist";
const OBSERVE = `${PLUGIN}/observe/recorder.cjs`;
const NODE_TEST = `${PLUGIN}/node-test/recorder.cjs`;

describe("isSquealRecorder", () => {
  it.each([
    OBSERVE,
    NODE_TEST,
    "/work/squeal/src/runners/observe/recorder.cjs",
    "/work/squeal/src/runners/node-test/runtime/recorder.cjs",
    pathToFileURL(OBSERVE).href,
  ])("%s is Squeal's", (specifier) => {
    expect(isSquealRecorder(specifier)).toBe(true);
  });

  it.each([
    "./scripts/setup.cjs",
    "observe/recorder.cjs",
    "./dist/observe/recorder.cjs",
    "/work/app/observe/recorder.cjs",
    "/work/app/dist/observe/recorder.mjs",
    "recorder-pkg",
  ])("%s is not", (specifier) => {
    expect(isSquealRecorder(specifier)).toBe(false);
  });
});

describe("withoutSquealRecorders", () => {
  it.each([
    [["--require", OBSERVE], []],
    [
      [`--require=${OBSERVE}`, "--require", "./setup.cjs"],
      ["--require", "./setup.cjs"],
    ],
    [
      ["-r", NODE_TEST, "--import", "tsx"],
      ["--import", "tsx"],
    ],
    [
      [`--import=${pathToFileURL(OBSERVE).href}`, "--conditions", "dev"],
      ["--conditions", "dev"],
    ],
    [
      ["--require", "./setup.cjs", "--max-old-space-size=4096"],
      ["--require", "./setup.cjs", "--max-old-space-size=4096"],
    ],
  ])("%j keeps %j", (tokens, kept) => {
    expect(withoutSquealRecorders(tokens)).toEqual(kept);
  });
});

const project = (env: Readonly<Record<string, string>> = {}): NodeTestProject => ({
  name: "p",
  argv: [],
  env,
  include: ["test/**/*.test.mjs"],
});

describe("projectEnv", () => {
  it("drops the inherited recorders, SQUEAL_OBSERVE and NODE_TEST_CONTEXT", () => {
    const env = projectEnv(project(), {
      PATH: "/bin",
      NODE_OPTIONS: `--require ${JSON.stringify(OBSERVE)}`,
      SQUEAL_OBSERVE: '{"out":"/tmp/o","root":"/w"}',
      NODE_TEST_CONTEXT: "child-v8",
    });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("keeps the rest of an inherited NODE_OPTIONS, quoted as Node reads it", () => {
    const env = projectEnv(project(), {
      NODE_OPTIONS: `--require "${OBSERVE}" --require "./my setup.cjs" --max-old-space-size=4096`,
    });
    expect(env.NODE_OPTIONS).toBe('--require "./my setup.cjs" --max-old-space-size=4096');
  });

  it("passes an inherited NODE_OPTIONS without a recorder verbatim", () => {
    const value = '"--require" ./setup.cjs';
    expect(projectEnv(project(), { NODE_OPTIONS: value }).NODE_OPTIONS).toBe(value);
  });

  it("merges the project's env over the inherited one, its NODE_OPTIONS as written", () => {
    const own = "--require ./scripts/setup.cjs";
    const env = projectEnv(project({ NODE_OPTIONS: own, MODE: "test" }), {
      NODE_OPTIONS: `--require ${OBSERVE}`,
      SQUEAL_OBSERVE: "{}",
      MODE: "dev",
    });
    expect(env).toEqual({ NODE_OPTIONS: own, MODE: "test" });
  });
});
