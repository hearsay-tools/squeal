import { describe, expect, it } from "vitest";
import type { SerializedError } from "vitest/node";
import {
  coverageWanted,
  providerFailed,
  recordProviderFailure,
  type VitestCoverage,
} from "../../../src/runners/vitest/coverage.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { RunCollector } from "../../../src/runners/vitest/reporter.js";

/* Row 015-70: which run errors say the workers could not load Squeal's provider. */

const ROOT = "/work/tree";
const PROVIDER = "/data/versions/0.1.347/dist/coverage/provider.mjs";

const coverage = (): VitestCoverage => ({
  enabled: () => true,
  provider: PROVIDER,
  tempDir: "/tmp/squeal",
  collected: () => {},
});

function collector(...errors: object[]): RunCollector {
  const collected = new RunCollector([], new WorktreePaths(ROOT));
  collected.unhandledErrors.push(...(errors as SerializedError[]));
  return collected;
}

const unloaded = (provider: string, cause?: object): object => ({
  name: "Error",
  message: `Failed to load custom CoverageProviderModule from ${provider}`,
  stack: `Error: Failed to load custom CoverageProviderModule from ${provider}`,
  ...(cause === undefined ? {} : { cause }),
});

describe("recordProviderFailure", () => {
  it("names the first cause with its code, and turns coverage off", () => {
    const covered = coverage();
    const cause = {
      message: `Cannot find module '/@fs${PROVIDER}'\n    at reviveInvokeError`,
      code: "ERR_MODULE_NOT_FOUND",
      cause: { message: "deeper" },
    };

    const recorded = recordProviderFailure(
      covered,
      collector(unloaded(PROVIDER, cause)),
      new WorktreePaths(ROOT),
    );

    const text = `coverage is off until the daemon restarts: a test worker could not load Squeal's coverage provider: Cannot find module '/@fs${PROVIDER}' (ERR_MODULE_NOT_FOUND) (spec 015 D8)`;
    expect(recorded).toEqual({ failure: text, note: text });
    expect(providerFailed(covered)).toBe(true);
    expect(coverageWanted(covered)).toBe(false);
  });

  it("names the error itself when it has no cause", () => {
    const recorded = recordProviderFailure(
      coverage(),
      collector(unloaded(PROVIDER)),
      new WorktreePaths(ROOT),
    );

    expect(recorded?.failure).toContain(
      `provider: Failed to load custom CoverageProviderModule from ${PROVIDER} (spec`,
    );
  });

  // Row 015-72: the fast and the slow instance on one coverage fail at once.
  it("gives a later failure on the same coverage its own cause and no note", () => {
    const covered = coverage();
    const failure = (module: string) =>
      recordProviderFailure(
        covered,
        collector(unloaded(PROVIDER, { message: `Cannot find module '${module}'` })),
        new WorktreePaths(ROOT),
      );

    const first = failure("/data/sibling-fast.mjs");
    const later = failure("/data/sibling-slow.mjs");

    expect(first?.note).toBe(first?.failure);
    expect(first?.failure).toContain("sibling-fast.mjs");
    expect(later?.note).toBeNull();
    expect(later?.failure).toContain("sibling-slow.mjs");
    expect(providerFailed(covered)).toBe(true);
  });

  it.each([
    { name: "another provider's", error: unloaded("/elsewhere/provider.mjs", { message: "x" }) },
    { name: "any other", error: { name: "Error", message: "orphan boom", stack: "" } },
  ])("leaves coverage on for $name error", ({ error }) => {
    const covered = coverage();

    expect(recordProviderFailure(covered, collector(error), new WorktreePaths(ROOT))).toBeNull();
    expect(providerFailed(covered)).toBe(false);
    expect(coverageWanted(covered)).toBe(true);
  });
});
