import { describe, expect, it } from "vitest";
import { collectEvidence, type GateAdapters } from "../../../src/core/code/gate/collect.js";
import type { SelectionSummary } from "../../../src/core/code/gate/prerun.js";
import { resolveScope } from "../../../src/core/code/gate/scope.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { GlobalSetupEntry, RunnerAdapter, RunReport } from "../../../src/core/types/runner.js";
import { changedSet, NO_ADAPTERS, project } from "./collect-fixture.js";

/*
 * Spec 020 D14.4 (row 020-15b, with 020-16a): the collector tells the
 * selection once, after it and before the first run: the files to run by
 * runner and group, the setups that will run, and each changed path no
 * selected file loads. Fake adapters on the `selection` fixture.
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
  /** Each call, in order: `told`, `run`. */
  readonly calls: string[];
}

/** An adapter that lists `listed`, selects each of them, and records when it runs. */
function fake({ listed = [LOADS], closures = {}, setups, calls }: Fake): RunnerAdapter {
  const adapter: Partial<RunnerAdapter> = {
    testFiles: async () => listed,
    affected: async () => ({ direct: [...listed], transitive: [] }),
    closure: async (ref) => {
      const paths = Object.hasOwn(closures, ref.path) ? closures[ref.path] : [ref.path];
      if (paths === null || paths === undefined) throw new Error("no closure");
      return { testFile: ref, paths: [...paths] } as Awaited<ReturnType<RunnerAdapter["closure"]>>;
    },
    run: async () => {
      calls.push("run");
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
): Promise<{ summary: SelectionSummary | null; calls: string[] }> {
  const root = project("selection");
  const scope = resolveScope(undefined, []);
  if ("error" in scope) throw new Error(scope.error);
  let summary: SelectionSummary | null = null;
  const calls: string[] = [];
  await collectEvidence(root, await changedSet(root, paths), {
    tests: [],
    budgetSeconds: 600,
    adapters,
    scope,
    selected: (s) => {
      calls.push("told");
      summary = s;
    },
    excluded,
  });
  return { summary, calls };
}

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

    expect([...order, ...calls]).toEqual(["told", "run"]);
    expect(summary).toEqual({
      runners: [{ runner: "vitest", files: 1, groups: [{ name: "tests", files: 1 }] }],
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

  it("is not called when no runner opens", async () => {
    const { summary, calls } = await told(NO_ADAPTERS, []);

    expect(summary).toBeNull();
    expect(calls).toEqual([]);
  });
});
