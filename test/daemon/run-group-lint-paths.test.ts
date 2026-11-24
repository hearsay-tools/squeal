import { describe, expect, it } from "vitest";
import { requestGroup } from "../../src/core/daemon/run-group.js";
import type { RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import type { Scheduler } from "../../src/core/types/scheduler.js";
import { LINT_ON } from "../lint/helpers.js";

/*
 * Review 0.1.616 B4 (spec 026 D4.3): a `run-group-paths` request for a
 * lint group of the daemon's policy releases only those paths' lint checks
 * (`Scheduler.requestGroup` with the paths), never the whole group, and
 * never as a test group's narrow run; a test group's paths stay a narrow run.
 */

const POLICY = {
  ...LINT_ON,
  checks: [
    { name: "unit", runner: "vitest", tests: ["test/**"], at: "manual" },
    { name: "lint", lint: true, at: "manual" },
  ],
} as typeof LINT_ON;
const PATHS = ["src/a.js"] as RelativePath[];
const QUEUED = { revision: 3 as RevisionNumber, queued: 1 };

function stub() {
  const calls: string[] = [];
  const scheduler = {
    requestGroup: (group: string, paths?: readonly RelativePath[]) => {
      calls.push(`group ${group}: ${paths?.join(",") ?? "whole"}`);
      return Promise.resolve(QUEUED);
    },
    requestGroupPaths: (group: string, paths: readonly RelativePath[]) => {
      calls.push(`narrow ${group}: ${paths.join(",")}`);
      return Promise.resolve({ ...QUEUED, narrow: {} });
    },
  } as unknown as Scheduler;
  return { scheduler, calls };
}

describe("run-group-paths for a lint group (review 0.1.616 B4)", () => {
  it("hands a lint group's paths to requestGroup, not the narrow run", async () => {
    const { scheduler, calls } = stub();
    await expect(requestGroup(scheduler, "lint", undefined, PATHS, {}, POLICY)).resolves.toEqual(
      QUEUED,
    );
    expect(calls).toEqual(["group lint: src/a.js"]);
  });

  it("keeps a test group's paths a narrow run, and a lint group without paths whole", async () => {
    const { scheduler, calls } = stub();
    await requestGroup(scheduler, "unit", undefined, PATHS, {}, POLICY);
    await requestGroup(scheduler, "lint", undefined, undefined, undefined, POLICY);
    expect(calls).toEqual(["narrow unit: src/a.js", "group lint: whole"]);
  });
});
