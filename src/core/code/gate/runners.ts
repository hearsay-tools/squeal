import { runsVitest } from "../../daemon/runner.js";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { NodeTestProject, Policy, PolicyInputs } from "../../types/policy.js";
import type { RunnerAdapter } from "../../types/runner.js";
import type {
  CoverageRun,
  CoveredFile,
  RunnerCoverageOptions,
  VitestCoverageOptions,
} from "../coverage/types.js";
import type { IncompleteClosure } from "./select-closures.js";
import type { TestFileEvidence } from "./types.js";

/*
 * Spec 020 D3 (row 020-03): the runners the collector opens, as the daemon
 * builds them (015 D8), each with Squeal's coverage on. D12 (row 020-10b):
 * with `coverage.children` at the base, they collect the coverage of the
 * processes and threads the tests start too.
 */

/**
 * The two adapters' constructors, `createVitestAdapter` and
 * `createNodeTestAdapter`, given by the caller: no file under
 * `src/core/code` imports a runner's folder (row 016-36). Typed by what the
 * collector passes, so each constructor fits as it is.
 */
export interface GateAdapters {
  readonly vitest: (options: {
    readonly root: AbsolutePath;
    readonly note: (text: string) => void;
    readonly excludeProjects: () => readonly string[];
    readonly exclude: () => readonly string[];
    /** D3.5: no results cache written into the project. */
    readonly cache: false;
    /** D17.3: the workers record runtime reads, as a daemon's do, when the runs may be kept. */
    readonly observe?: () => boolean;
    /** Always on; D12: `children` is `coverage.children` at the base. */
    readonly coverage: VitestCoverageOptions;
    /** Row 020-43: told each file as it starts; what it returns, as it ends. */
    readonly fileStarted: FileStarted;
  }) => Promise<RunnerAdapter>;
  readonly nodeTest: (
    project: NodeTestProject,
    options: {
      readonly root: AbsolutePath;
      readonly note: (text: string) => void;
      readonly concurrency: () => number;
      readonly inputs: () => PolicyInputs;
      readonly tempDir: AbsolutePath;
      /** Always on; D12: `children` is `coverage.children` at the base. */
      readonly coverage: RunnerCoverageOptions;
      /** #193: the project's files with an incomplete closure; the gate tells them after selection. */
      readonly closures: (files: readonly IncompleteClosure[]) => void;
      /** D18 as amended (row 020-44): the pool every entry's processes come from. */
      readonly slots: (signal: AbortSignal) => Promise<(() => void) | null>;
      /** Row 020-43: told each file as it starts; what it returns, as it ends. */
      readonly fileStarted: FileStarted;
    },
  ) => Promise<RunnerAdapter>;
}

/** Told a test file started; what it returns is called once it ended (row 020-43). */
export type FileStarted = (testFile: TestFileRef) => () => void;

/** One opened adapter and the payloads its runs handed over. */
export interface Runner {
  readonly kind: TestFileEvidence["runner"];
  readonly adapter: RunnerAdapter;
  readonly covered: CoveredFile[];
  /** A node:test runner's entry, for its `prepare` (D15). */
  readonly project?: NodeTestProject;
}

/**
 * Vitest when the daemon would run it (`runsVitest`), then each `nodeTest`
 * project, in the policy's order. Each adapter opened is pushed at once, so
 * a later failure still closes it.
 */
export async function openRunners(
  adapters: GateAdapters,
  root: AbsolutePath,
  policy: Policy,
  {
    provider,
    temp,
    note,
    children,
    keeping,
    closures,
    slots,
    started,
  }: {
    provider: AbsolutePath;
    temp: AbsolutePath;
    note: (text: string) => void;
    children: boolean;
    /** D17.3: the runs may be kept, so Vitest records runtime reads as policy says. */
    keeping: boolean;
    /** #193: told each node:test project's files with an incomplete closure, each time its adapter tells them. */
    closures: (project: string, files: readonly IncompleteClosure[]) => void;
    /** D18 as amended (row 020-44): one pool of slots for every node:test entry's processes. */
    slots: (signal: AbortSignal) => Promise<(() => void) | null>;
    /** Row 020-43: told each runner's file as it starts, by the runner kind. */
    started: (runner: TestFileEvidence["runner"], testFile: TestFileRef) => () => void;
  },
  runners: Runner[],
): Promise<void> {
  if (runsVitest(root, policy)) {
    const covered: CoveredFile[] = [];
    const collected = (run: CoverageRun) => covered.push(...run.files);
    const adapter = await adapters.vitest({
      root,
      note,
      excludeProjects: () => policy.vitest.excludeProjects,
      exclude: () => policy.vitest.exclude,
      cache: false,
      observe: () => keeping && policy.observe.runtimeInputs,
      coverage: {
        enabled: () => true,
        children: () => children,
        provider,
        tempDir: temp,
        collected,
      },
      fileStarted: (ref) => started("vitest", ref),
    });
    runners.push({ kind: "vitest", adapter, covered });
  }
  for (const project of policy.nodeTest) {
    const covered: CoveredFile[] = [];
    const collected = (run: CoverageRun) => covered.push(...run.files);
    const adapter = await adapters.nodeTest(project, {
      root,
      note,
      // One process per file, `runner.tierSize` at once, as the daemon's edit tiers run.
      concurrency: () => policy.runner.tierSize,
      inputs: () => policy.inputs,
      tempDir: temp,
      coverage: { enabled: () => true, children: () => children, collected },
      closures: (files) => closures(project.name, files),
      slots,
      fileStarted: (ref) => started("node-test", ref),
    });
    runners.push({ kind: "node-test", adapter, covered, project });
  }
}
