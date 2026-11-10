import { describe, expect, it } from "vitest";
import {
  collectEvidence,
  type GateAdapters,
  type StoredEvidence,
} from "../../../src/core/code/gate/collect.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { ADAPTERS, changedSet, ownTmpdir, project, SLOW } from "./collect-fixture.js";

/*
 * Spec 020 D11.7 (row 020-07c): the collector asks `stored` for the
 * evidence the stores hold of each runner's selected files, and runs only
 * the files it leaves out. The stored evidence is kept as given.
 */

/** The adapters, each Vitest run's files appended to `ran`; the fixture has no other runner. */
function watched(ran: string[]): GateAdapters {
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (key !== "run" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (files: readonly TestFileRef[], ...rest: unknown[]) => {
          ran.push(...files.map((f) => f.path));
          return (value as (...args: unknown[]) => unknown).call(target, files, ...rest);
        };
      },
    });
  return { ...ADAPTERS, vitest: async (options) => wrap(await ADAPTERS.vitest(options)) };
}

const STORED = (path: string): TestFileEvidence => ({
  runner: "vitest",
  path,
  completed: true,
  failed: ["stored > fails"],
  skipped: false,
  loads: [path, "src/changed.ts"],
  record: null,
  from: "store",
});

describe("collectEvidence: stored evidence (spec 020 D11.7)", () => {
  it("does not run a selected file the stores hold, and keeps its evidence", SLOW, async () => {
    const root = project("selection");
    const leftInTmp = ownTmpdir();
    const ran: string[] = [];
    const asked: [string, string[]][] = [];
    const stored: StoredEvidence = async (runner, files) => {
      asked.push([runner, files.map((f) => f.path)]);
      return new Map(files.map((ref) => [ref, STORED(ref.path)]));
    };

    const evidence = await collectEvidence(root, await changedSet(root, ["src/changed.ts"]), {
      tests: [],
      budgetSeconds: 600,
      adapters: watched(ran),
      stored,
    });

    expect(asked).toEqual([["vitest", ["test/loads.test.ts"]]]);
    expect(ran).toEqual([]);
    expect(evidence.testFiles).toEqual([STORED("test/loads.test.ts")]);
    expect(evidence.timedOut).toBe(false);
    expect(leftInTmp()).toEqual([]);
  });

  it("runs the selected files the stores leave out", SLOW, async () => {
    const root = project("selection");
    const ran: string[] = [];
    const evidence = await collectEvidence(
      root,
      await changedSet(root, ["src/changed.ts", "src/fails.ts"]),
      {
        tests: [],
        budgetSeconds: 600,
        adapters: watched(ran),
        stored: async (_runner, files) =>
          new Map(
            files.filter((f) => f.path === "test/fails.test.ts").map((f) => [f, STORED(f.path)]),
          ),
      },
    );

    expect(ran).toEqual(["test/loads.test.ts"]);
    const summary = evidence.testFiles.map((f) => [f.path, f.completed, f.from ?? "run"]);
    expect(summary).toEqual([
      ["test/fails.test.ts", true, "store"],
      ["test/loads.test.ts", true, "run"],
    ]);
  });
});
