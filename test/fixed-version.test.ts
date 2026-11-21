import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { squealVersion } from "../src/core/daemon/version.js";
import { TEST_VERSION, VERSION_ARGS } from "./fixed-version.js";

/* Row 011-425: the fixed version of the worker and of the processes started with it. */
describe("the tests' fixed version", () => {
  const started = (args: readonly string[]) =>
    execFileSync(
      process.execPath,
      [...args, "-e", "process.stdout.write(String(globalThis.__SQUEAL_VERSION__))"],
      { encoding: "utf8" },
    );

  it("is the worker's version", () => {
    expect(squealVersion()).toBe(TEST_VERSION);
  });

  it("is the version of a process started with VERSION_ARGS, and of no other", () => {
    expect(started(VERSION_ARGS)).toBe(TEST_VERSION);
    expect(started([])).toBe("undefined");
  });
});
