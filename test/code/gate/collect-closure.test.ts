import { describe, expect, it } from "vitest";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunnerClosure } from "../../../src/core/types/runner.js";
import { changedSet, NO_ADAPTERS, project } from "./collect-fixture.js";

/*
 * Spec 020 D13.2 (row 020-08b): the collector gives the known evidence its
 * runner's closure of each file (request 757e82da). A closure the runner
 * cannot give reads `null`, and the file is the evidence's to leave out.
 */

const REF: TestFileRef = { project: "", path: "test/loads.test.ts" };

/** A Vitest adapter that lists `REF`, cannot give its closure, and fails if it runs. */
function noClosure(): RunnerAdapter {
  const adapter: Pick<RunnerAdapter, "testFiles" | "affected" | "closure" | "run" | "close"> = {
    testFiles: async () => [REF],
    affected: async () => ({ direct: [REF], transitive: [] }),
    closure: () => Promise.reject(new Error("no closure")),
    run: () => Promise.reject(new Error("the file ran")),
    close: async () => {},
  };
  return adapter as RunnerAdapter;
}

const KNOWN: TestFileEvidence = {
  runner: "vitest",
  path: REF.path,
  completed: true,
  failed: [],
  skipped: false,
  loads: null,
  record: null,
  from: "parts",
};

describe("collectEvidence: the closure it gives the known evidence (spec 020 D13.2)", () => {
  it("reads null when the runner cannot give one", async () => {
    const root = project("selection");
    const closures: (RunnerClosure | null | undefined)[] = [];

    const evidence = await collectEvidence(root, await changedSet(root, ["src/changed.ts"]), {
      tests: [],
      budgetSeconds: 600,
      adapters: { ...NO_ADAPTERS, vitest: async () => noClosure() },
      stored: async (_runner, files, closure) => {
        for (const ref of files) closures.push(await closure?.(ref));
        return new Map(files.map((ref) => [ref, KNOWN]));
      },
    });

    expect(closures).toEqual([null]);
    expect(evidence.testFiles).toEqual([KNOWN]);
  });
});
