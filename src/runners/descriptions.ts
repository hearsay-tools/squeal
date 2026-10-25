import { posix } from "node:path";
import type { AbsolutePath, NodeTestProject, Policy, TestFileRef } from "../core/types/index.js";
import {
  NODE_TEST,
  type NodeTestCommand,
  type NodeTestContext,
  type NodeTestCoverage,
} from "./node-test/describe.js";
import {
  PYTEST,
  type PytestCommand,
  type PytestContext,
  type PytestCoverage,
} from "./pytest/describe.js";
import {
  VITEST,
  type VitestCommand,
  type VitestContext,
  type VitestCoverage,
} from "./vitest/describe.js";

/*
 * Spec 016 D5: what the harness knows of each runner, said by the runner in
 * its own `describe.ts`: how its test commands look, for 005 D8's deny, with
 * what the deny discovers for them; its name in the primer and its entry in
 * the coverage list. `src/harness/shared` reads every runner here and names
 * none. The rules of 005 D8 and 011 C8 stay where they are.
 */

/** One project as the primer lists it: its name and its include globs, relative to the root. */
export interface CoveredProject {
  readonly name: string;
  readonly include: readonly string[];
}

/** A project as squeal.config.json configures it: its name, its `cwd` and its include globs. */
export interface ConfiguredProject {
  readonly name: string;
  readonly cwd?: string;
  readonly include: readonly string[];
}

/** What Squeal covers of each runner in one worktree, one part per runner (task 001-234). */
export type RunnerCoverage = VitestCoverage & NodeTestCoverage & PytestCoverage;

/** Spec 005 D8 step 1: what recognition reads besides the command, one part per runner. */
export type CommandContext = VitestContext &
  NodeTestContext &
  PytestContext & {
    /** `false` when the command runs from a directory other than the worktree root. Absent means `true`. */
    readonly atRoot?: boolean;
  };

/** A recognized test command: what it runs, before resolution to test files. */
export type TestCommand = VitestCommand | NodeTestCommand | PytestCommand;

/** A runner's entry in the primer's coverage list: the config it reads, or its projects. */
export type Covered =
  | {
      /** The config file the runner finds at the root; `null` without one. */
      readonly config: string | null;
      /** Its projects squeal.config.json excludes, never run (001 D11, task 001-349). */
      readonly excludedProjects: readonly string[];
    }
  | {
      /** Each configured project, with its globs from the root (spec 007 D8). */
      readonly projects: readonly CoveredProject[];
    };

/** What a runner reads of a worktree for its part of the coverage, as the daemon reads it. */
export interface CoverageRead {
  readonly policy: Policy;
  readonly root: AbsolutePath;
  /** Whether squeal.config.json configures any runner's project. */
  readonly configured: boolean;
  /** The runner's own configured projects, as the primer lists them. */
  readonly projects: readonly CoveredProject[];
}

/** Spec 005 D8 step 2: what a command's test files resolve against. */
export interface Listing {
  /** Squeal's own listing of the worktree: every test file of every project. */
  readonly files: readonly TestFileRef[];
  /** The worktree root, which the command runs from. */
  readonly root: AbsolutePath;
  /** The names of the projects squeal.config.json configures, unique across runners (spec 003 D7). */
  readonly configured: ReadonlySet<string>;
  /** Test files the listing left out because Squeal does not run them; `null` with no count recorded. */
  readonly omitted: number | null;
  /** `path` as the command wrote it, relative to `root` with `/` separators; `null` outside it. */
  readonly pathOf: (path: string) => string | null;
}

/** A shell text's words with quotes removed, or `null` when a shell would act on it. */
export type ShellWords = (text: string) => readonly string[] | null;

/** One runner as it describes itself to the harness (spec 016 D5). */
export interface RunnerDescription {
  /** The `runner` of its test commands. */
  readonly runner: TestCommand["runner"];
  /** Its name, as the primer says it. */
  readonly name: string;
  /**
   * Spec 003 D7: the runner the daemon builds when squeal.config.json
   * configures no other; its projects are the listing's others.
   */
  readonly fallback: boolean;
  /** Its part of the coverage of a repository whose root is not read yet. */
  readonly unconfigured: Partial<RunnerCoverage>;
  /** Its projects squeal.config.json configures. */
  projects(policy: Policy): readonly ConfiguredProject[];
  /** Its part of the coverage of a worktree. */
  coverage(read: CoverageRead): Partial<RunnerCoverage>;
  /** Whether the daemon builds it, by `coverage`. */
  built(coverage: RunnerCoverage): boolean;
  /** Its entry in the primer's coverage list. */
  covered(coverage: RunnerCoverage): Covered;
  /** Its test files squeal.config.json excludes, as the primer names them; `null` for none. */
  excluded(coverage: RunnerCoverage): string | null;
  /** Its part of a command's context, for a command run from the real directory `cwd`. */
  context(policy: Policy, root: AbsolutePath, cwd: string): Partial<CommandContext>;
  /** The test command of its own that `words` are, or `null`. */
  command(words: readonly string[], context: CommandContext, split: ShellWords): TestCommand | null;
  /** Whether its commands can resolve under the policy as it reads now (review 004 wave-12 B2). */
  resolves(live: Policy): boolean;
  /** The test files its `command` runs, or `null` when they cannot be resolved completely. */
  files(command: TestCommand, listing: Listing): readonly TestFileRef[] | null;
  /** Spec 004 D1: its projects whose `slow: true` marks their files slow, as the daemon reads them. */
  slowProjects(policy: Policy): readonly NodeTestProject[];
}

/** Every runner, in the order the primer names them and recognition tries their commands. */
export const DESCRIPTIONS: readonly RunnerDescription[] = [VITEST, NODE_TEST, PYTEST];

/** The runners' part of the coverage of a repository whose root is not read yet. */
export const UNCONFIGURED: RunnerCoverage = {
  ...VITEST.unconfigured,
  ...NODE_TEST.unconfigured,
  ...PYTEST.unconfigured,
};

/** Every runner's projects squeal.config.json configures. */
export function configuredProjects(policy: Policy): ConfiguredProject[] {
  return DESCRIPTIONS.flatMap((description) => description.projects(policy));
}

/** Spec 004 D1: every runner's projects whose `slow: true` marks their files slow. */
export function slowProjects(policy: Policy): NodeTestProject[] {
  return DESCRIPTIONS.flatMap((description) => description.slowProjects(policy));
}

/** The runners' part of the coverage of the worktree at `root`, read as the daemon reads it. */
export function runnerCoverage(policy: Policy, root: AbsolutePath): RunnerCoverage {
  const configured = configuredProjects(policy).length > 0;
  const read = (description: RunnerDescription): CoverageRead => ({
    policy,
    root,
    configured,
    projects: description.projects(policy).map(fromRoot),
  });
  return {
    ...VITEST.coverage(read(VITEST)),
    ...NODE_TEST.coverage(read(NODE_TEST)),
    ...PYTEST.coverage(read(PYTEST)),
  };
}

/** The context of a command run from the real directory `cwd` inside the worktree at `root`. */
export function commandContext(policy: Policy, root: AbsolutePath, cwd: string): CommandContext {
  return {
    ...VITEST.context(policy, root, cwd),
    ...NODE_TEST.context(policy, root, cwd),
    ...PYTEST.context(policy, root, cwd),
    atRoot: cwd === root,
  };
}

/** The runner whose test command `command` is. */
export function describing(command: TestCommand): RunnerDescription {
  return DESCRIPTIONS.find(
    (description) => description.runner === command.runner,
  ) as RunnerDescription;
}

/** A project's name and its include globs, relative to the root. */
function fromRoot({ name, cwd, include }: ConfiguredProject): CoveredProject {
  return {
    name,
    include: include.map((glob) => (cwd === undefined ? glob : posix.join(cwd, glob))),
  };
}
