import { describe, expect, it, vi } from "vitest";
import type { DependencyKeys } from "../../src/core/keys/dependencies.js";
import { formerReadAsOne } from "../../src/core/keys/former.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import type { CoreEnvironmentInputs, RunnerEnvironment } from "../../src/core/types/index.js";

// Row 011-90 (011 C3): the next format raise ends the read of the definition before 011-85, as it
// empties `KEY_FORMATS_READ_AS_ONE`. Rows stored under an older format mean something else then.
vi.mock("../../src/core/keys/key-format.js", async (original) => ({
  ...(await original<typeof import("../../src/core/keys/key-format.js")>()),
  KEY_FORMAT_VERSION: 21,
  KEY_FORMATS_READ_AS_ONE: {},
}));

const CORE: CoreEnvironmentInputs = {
  squealVersion: "0",
  nodeVersion: "v24.0.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "deps-now",
  env: {},
};
const ENVIRONMENT: RunnerEnvironment = {
  project: "server",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "3",
  resolvedConfig: "{}",
  files: ["vitest.config.ts"],
  formerFiles: ["e2e/vitest.config.ts", "vitest.config.ts"],
};
const former: DependencyKeys = { environment: "deps-then", of: () => "" };
/** Row 011-167: and the pnpm definition before 011-162, stored at format 20 only. */
const formerPnpm: DependencyKeys = { environment: "deps-whole", of: () => "" };
const keys: DependencyKeys = {
  environment: "deps-now",
  of: () => "whole:deps-now",
  former,
  formerPnpm,
};

describe("the definitions before 011-85 and 011-162 after a format raise (011-90, 011-167)", () => {
  it("reads nothing at format 21, whose raise empties the formats read as one", () => {
    expect(KEY_FORMAT_VERSION).toBe(21);
    expect(
      formerReadAsOne(
        CORE,
        ENVIRONMENT,
        keys,
        () => "h",
        () => undefined,
      ),
    ).toEqual([]);
  });
});
