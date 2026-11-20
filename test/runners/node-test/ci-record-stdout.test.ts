import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readPartsIn } from "../../../src/core/ci/parts.js";
import { nodeTestCommand, project, reporterPair, TEST_FILES, temp } from "./ci-record-kit.js";

/*
 * Spec 018 D22, D23 (row 018-47): the recorded command's output and exit
 * code stay the project's. With the reporter pair, `squeal ci record` prints
 * to stdout what the same command prints without it, durations aside, on
 * every Node it runs on: this test's own, and Node 22, 24 and 26 where this
 * host has them (nvm's). A failing test's exit code passes through.
 */

const SLOW = { timeout: 180_000 } as const;
const CLI = resolve(import.meta.dirname, "ci-record-cli.ts");
const NVM = join(homedir(), ".nvm/versions/node");
const NODES = [
  process.execPath,
  ...["v22.23.3", "v24.21.0", "v26.13.0"]
    .map((version) => join(NVM, version, "bin/node"))
    .filter((node) => node !== process.execPath && existsSync(node)),
];

/** Durations and timings, which differ between any two runs. */
const timeless = (text: string) =>
  text
    .replace(/\(node:\d+\)/g, "(node)")
    .replace(/\(\d+(\.\d+)?ms\)/g, "(ms)")
    .replace(/duration_ms \d+(\.\d+)?/g, "duration_ms");

/**
 * Without `NODE_USE_ENV_PROXY`: on Node 22 it makes an async loader's hooks
 * thread print an experimental warning only when no preload is in
 * `NODE_OPTIONS`, so any preload, the daemon's own recorder too, changes it.
 */
const { NODE_USE_ENV_PROXY: _proxy, ...ENV } = process.env;

function run(root: string, command: readonly string[]) {
  const [program, ...args] = command;
  return spawnSync(program as string, args, { cwd: root, encoding: "utf8", env: ENV });
}

describe("the recorded command's output", () => {
  it.each(NODES)("is the command's own on %s", SLOW, (node) => {
    const root = project();
    const command = nodeTestCommand(node, [...reporterPair(), ...TEST_FILES]);
    const plain = run(root, command);
    const out = join(temp(), "parts");
    const ci = [process.execPath, "--import", "tsx", CLI, "record", "--out", out, "--", ...command];
    const recorded = run(root, ci);
    expect(recorded.status, recorded.stderr).toBe(plain.status);
    expect(plain.status).toBe(0);
    expect(timeless(recorded.stdout)).toBe(timeless(plain.stdout));
    const parts = readPartsIn([out]);
    if (typeof parts === "string") throw new Error(parts);
    expect(
      parts.flatMap(({ part }) => part.testFiles.map((f) => f.path)),
      recorded.stderr,
    ).toEqual(TEST_FILES);
  });

  it("passes a failing command's exit code through", SLOW, () => {
    const root = project({
      ...Object.fromEntries([
        ["squeal.config.json", '{"nodeTest":[{"name":"u","include":["*.test.mjs"]}]}\n'],
      ]),
      "fails.test.mjs":
        'import { test } from "node:test";\ntest("fails", () => { throw new Error("no"); });\n',
    });
    const command = [process.execPath, "--test", ...reporterPair(), "fails.test.mjs"];
    const out = join(temp(), "parts");
    const recorded = run(root, [
      process.execPath,
      "--import",
      "tsx",
      CLI,
      "record",
      "--out",
      out,
      "--",
      ...command,
    ]);
    expect(recorded.status, recorded.stderr).toBe(1);
    const parts = readPartsIn([out]);
    if (typeof parts === "string") throw new Error(parts);
    expect(parts[0]?.part.testFiles.map((f) => [f.path, f.outcome])).toEqual([
      ["fails.test.mjs", "fail"],
    ]);
  });
});
