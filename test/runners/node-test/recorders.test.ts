import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { projectEnv } from "../../../src/runners/node-test/recorders.js";
import {
  isSquealRecorder,
  UNOBSERVED,
  withoutSquealRecorders,
} from "../../../src/runners/process/recorders.js";

/**
 * Task 003-35: under a Squeal daemon a test process inherits 001-132's
 * recorder in `NODE_OPTIONS` and its settings in `SQUEAL_OBSERVE`. Neither is
 * the project's: the node:test runner keys and runs a project as a plain
 * shell would, and a project's own `--require` still counts. Task 001-431:
 * the settings become `UNOBSERVED`, so the recorder's spawn hook, still in the
 * daemon's test process that starts the run, leaves its processes alone.
 */

const PLUGIN = "/home/u/.claude/plugins/cache/squeal/squeal/0.1.40/dist";
const OBSERVE = `${PLUGIN}/observe/recorder.cjs`;
const NODE_TEST = `${PLUGIN}/node-test/recorder.cjs`;
/** Task 026-26: a remote bundle at `<cache>/squeal/<version>/`, without `dist/`. */
const REMOTE = "/home/node/.squeal-remote/squeal/0.1.634";

describe("isSquealRecorder", () => {
  it.each([
    OBSERVE,
    NODE_TEST,
    "/work/squeal/src/runners/observe/recorder.cjs",
    "/work/squeal/src/runners/node-test/runtime/recorder.cjs",
    pathToFileURL(OBSERVE).href,
    `${REMOTE}/observe/recorder.cjs`,
    `${REMOTE}/node-test/recorder.cjs`,
    pathToFileURL(`${REMOTE}/observe/recorder.cjs`).href,
    pathToFileURL(`${REMOTE}/node-test/recorder.cjs`).href,
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
    "squeal/0.1.634/observe/recorder.cjs",
    "./squeal/0.1.634/node-test/recorder.cjs",
    `${REMOTE}/observe/recorder.mjs`,
    `${REMOTE}/node-test/recorder.mjs`,
    `${REMOTE}/lib/observe/recorder.cjs`,
    "/work/squeal/observe/recorder.cjs",
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
      ["--import", pathToFileURL(`${REMOTE}/observe/recorder.cjs`).href, "-r", "./setup.cjs"],
      ["-r", "./setup.cjs"],
    ],
    [
      [`--require=${REMOTE}/node-test/recorder.cjs`, "--import", "/work/app/observe/recorder.cjs"],
      ["--import", "/work/app/observe/recorder.cjs"],
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
  it("drops the inherited recorders and NODE_TEST_CONTEXT, and their settings for UNOBSERVED", () => {
    const env = projectEnv(project(), {
      PATH: "/bin",
      NODE_OPTIONS: `--require ${JSON.stringify(OBSERVE)}`,
      SQUEAL_OBSERVE: '{"out":"/tmp/o","root":"/w"}',
      NODE_TEST_CONTEXT: "child-v8",
    });
    expect(env).toEqual({ PATH: "/bin", SQUEAL_OBSERVE: UNOBSERVED });
  });

  it("drops a remote bundle's recorder, imported by file: URL (task 026-26)", () => {
    const env = projectEnv(project(), {
      PATH: "/bin",
      NODE_OPTIONS: `--import ${pathToFileURL(`${REMOTE}/observe/recorder.cjs`).href}`,
    });
    expect(env).toStrictEqual({ PATH: "/bin" });
  });

  it("adds no SQUEAL_OBSERVE where none was inherited", () => {
    const env = projectEnv(project(), { PATH: "/bin", NODE_OPTIONS: `--require ${OBSERVE}` });
    expect(env).toStrictEqual({ PATH: "/bin" });
  });

  it("gives an ordinary run's processes the env it inherited, no SQUEAL_OBSERVE, NODE_OPTIONS as it was", () => {
    const inherited = {
      PATH: "/bin",
      NODE_OPTIONS: "--require ./setup.cjs --max-old-space-size=4096",
    };
    expect(projectEnv(project(), inherited)).toStrictEqual(inherited);
    expect(projectEnv(project(), { PATH: "/bin" })).toStrictEqual({ PATH: "/bin" });
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
    expect(env).toEqual({ NODE_OPTIONS: own, MODE: "test", SQUEAL_OBSERVE: UNOBSERVED });
  });
});
