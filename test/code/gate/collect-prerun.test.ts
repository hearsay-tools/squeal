import { describe, expect, it } from "vitest";
import { type CollectOptions, collectEvidence } from "../../../src/core/code/gate/collect.js";
import type { SelectionSummary } from "../../../src/core/code/gate/prerun.js";
import type { GateAdapters } from "../../../src/core/code/gate/runners.js";
import { resolveScope } from "../../../src/core/code/gate/scope.js";
import type { Evidence, TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { GlobalSetupEntry, RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
import { changedSet, NO_ADAPTERS, project } from "./collect-fixture.js";
import { quiet } from "./host-load.js";

/*
 * Spec 020 D14.4 (row 020-15b, with 020-16a): the collector tells the
 * selection once, after it and before the first run: the files to run by
 * runner and group, the setups that will run, and each changed path no
 * selected file loads. Fake adapters on the `selection` fixture. Review
 * 0.1.432 B2: a file known from the stores or the parts does not run, so
 * the selection and the run are counted apart, and only the setups of the
 * files that run are named.
 */

const LOADS: TestFileRef = { project: "server", path: "test/loads.test.ts" };

const SETUPS: readonly GlobalSetupEntry[] = [
  { project: "", root: true, files: ["setup/root.ts"] },
  { project: "server", root: false, files: ["setup/server.ts"] },
  { project: "browser", root: false, files: ["setup/browser.ts"] },
];

const EMPTY_REPORT = {
  end: "completed",
  completedFiles: [],
  results: [],
  fileErrors: [],
} as unknown as RunReport;

interface Fake {
  readonly listed?: readonly TestFileRef[];
  readonly closures?: Readonly<Record<string, readonly string[] | null>>;
  readonly setups?: readonly GlobalSetupEntry[];
  /** Each call, in order: `told`, `run <paths>`. */
  readonly calls: string[];
}

/** An adapter that lists `listed`, selects each of them, and records when it runs. */
function fake({ listed = [LOADS], closures = {}, setups, calls }: Fake): RunnerAdapter {
  const adapter: Partial<RunnerAdapter> = {
    traits: NO_TRAITS,
    testFiles: async () => listed,
    affected: async () => ({ direct: [...listed], transitive: [] }),
    closure: async (ref) => {
      const paths = Object.hasOwn(closures, ref.path) ? closures[ref.path] : [ref.path];
      if (paths === null || paths === undefined) throw new Error("no closure");
      return { testFile: ref, paths: [...paths] } as Awaited<ReturnType<RunnerAdapter["closure"]>>;
    },
    run: async (files) => {
      calls.push(`run ${files.map((f) => f.path).join(" ")}`);
      return EMPTY_REPORT;
    },
    close: async () => {},
    ...(setups === undefined ? {} : { globalSetups: async () => setups }),
  };
  return adapter as RunnerAdapter;
}

async function told(
  adapters: GateAdapters,
  paths: readonly string[],
  excluded: (path: string) => boolean = () => false,
  stored?: CollectOptions["stored"],
): Promise<{ summary: SelectionSummary | null; calls: string[]; evidence: Evidence }> {
  const root = project("selection");
  const scope = resolveScope(undefined, []);
  if ("error" in scope) throw new Error(scope.error);
  let summary: SelectionSummary | null = null;
  const calls: string[] = [];
  const evidence = await collectEvidence(root, await changedSet(root, paths), {
    hostLoad: quiet,
    tests: [],
    budgetSeconds: 600,
    adapters,
    scope,
    selected: (s) => {
      calls.push("told");
      summary = s;
    },
    excluded,
    ...(stored === undefined ? {} : { stored }),
  });
  return { summary, calls, evidence };
}

/** Completed evidence of `ref` read from `from`, as the stores or the parts give it. */
const known = (ref: TestFileRef, from: "store" | "parts"): TestFileEvidence => ({
  runner: "vitest",
  path: ref.path,
  completed: true,
  failed: [],
  skipped: false,
  loads: [ref.path, "src/changed.ts"],
  record: null,
  from,
});

/** A `stored` that gives the evidence of each selected file `from` names, read from there. */
const knownFrom =
  (from: Readonly<Record<string, "store" | "parts">>): CollectOptions["stored"] =>
  async (_runner, files) => {
    const found = new Map<TestFileRef, TestFileEvidence>();
    for (const ref of files) {
      const where = from[ref.path];
      if (where !== undefined) found.set(ref, known(ref, where));
    }
    return found;
  };

describe("collectEvidence: the selection told before the first run (spec 020 D14.4)", () => {
  it("tells the files to run by group, and the setups of the root and of projects that run, before any run", async () => {
    const calls: string[] = [];
    const vitest = fake({
      setups: SETUPS,
      closures: { [LOADS.path]: [LOADS.path, "src/changed.ts"] },
      calls,
    });
    const { summary, calls: order } = await told({ ...NO_ADAPTERS, vitest: async () => vitest }, [
      "src/changed.ts",
    ]);

    expect([...order, ...calls]).toEqual(["told", "run test/loads.test.ts"]);
    expect(summary).toEqual({
      runners: [
        {
          runner: "vitest",
          files: 1,
          run: 1,
          known: { store: 0, parts: 0 },
          groups: [{ name: "tests", files: 1 }],
        },
      ],
      leftOut: [],
      setups: [SETUPS[0], SETUPS[1]],
      unloaded: [],
    });
  });

  it("names each changed path no selected file loads, but not one coverage.exclude matches", async () => {
    const calls: string[] = [];
    const vitest = fake({ closures: { [LOADS.path]: [LOADS.path, "src/changed.ts"] }, calls });
    const paths = ["src/changed.ts", "src/orphan.ts", "src/other.ts"];

    const { summary } = await told({ ...NO_ADAPTERS, vitest: async () => vitest }, paths, (p) =>
      p.endsWith("other.ts"),
    );

    // No `globalSetups`: no setup, and no error.
    expect(summary).toMatchObject({ setups: [], unloaded: ["src/orphan.ts"] });
  });

  it("names no path when a selected file's closure is not known: it may load any", async () => {
    const calls: string[] = [];
    const vitest = fake({ closures: { [LOADS.path]: null }, calls });

    const { summary } = await told({ ...NO_ADAPTERS, vitest: async () => vitest }, [
      "src/orphan.ts",
    ]);

    expect(summary?.unloaded).toEqual([]);
  });

  for (const from of ["store", "parts"] as const) {
    it(`names no setup when every selected file is read from the ${from === "store" ? "stores" : "parts"}, and runs none`, async () => {
      const calls: string[] = [];
      const closures = { [LOADS.path]: [LOADS.path, "src/changed.ts"] };
      const vitest = fake({ setups: SETUPS, closures, calls });
      const {
        summary,
        calls: order,
        evidence,
      } = await told(
        { ...NO_ADAPTERS, vitest: async () => vitest },
        ["src/changed.ts"],
        () => false,
        knownFrom({ [LOADS.path]: from }),
      );

      expect([...order, ...calls]).toEqual(["told"]);
      expect(summary).toEqual({
        runners: [
          {
            runner: "vitest",
            files: 1,
            run: 0,
            known: { store: from === "store" ? 1 : 0, parts: from === "parts" ? 1 : 0 },
            groups: [{ name: "tests", files: 1 }],
          },
        ],
        leftOut: [],
        setups: [],
        unloaded: [],
      });
      expect(evidence.testFiles).toEqual([known(LOADS, from)]);
    });
  }

  it("names the root's setup and those of projects that run, not of a project read only from the stores", async () => {
    const calls: string[] = [];
    const served: TestFileRef = { project: "server", path: "test/other.test.ts" };
    const runs: TestFileRef = { project: "browser", path: "test/loads.test.ts" };
    const parted: TestFileRef = { project: "browser", path: "test/fails.test.ts" };
    const vitest = fake({ listed: [served, runs, parted], setups: SETUPS, calls });
    const stored = knownFrom({ [served.path]: "store", [parted.path]: "parts" });

    const {
      summary,
      calls: order,
      evidence,
    } = await told(
      { ...NO_ADAPTERS, vitest: async () => vitest },
      ["src/changed.ts"],
      () => false,
      stored,
    );

    expect([...order, ...calls]).toEqual(["told", "run test/loads.test.ts"]);
    expect(summary?.runners).toEqual([
      {
        runner: "vitest",
        files: 3,
        run: 1,
        known: { store: 1, parts: 1 },
        groups: [{ name: "tests", files: 3 }],
      },
    ]);
    expect(summary?.setups).toEqual([SETUPS[0], SETUPS[2]]);
    expect(evidence.testFiles.map((f) => [f.path, f.from])).toEqual([
      [parted.path, "parts"],
      [runs.path, undefined],
      [served.path, "store"],
    ]);
  });

  it("is not called when no runner opens", async () => {
    const { summary, calls } = await told(NO_ADAPTERS, []);

    expect(summary).toBeNull();
    expect(calls).toEqual([]);
  });
});
