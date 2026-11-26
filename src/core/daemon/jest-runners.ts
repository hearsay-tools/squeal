import { createHash } from "node:crypto";
import { join } from "node:path";
import { createJestAdapter } from "../../runners/jest/adapter.js";
import { jestTraits } from "../../runners/jest/traits.js";
import { JEST_ADAPTER_VERSION } from "../../runners/jest/version.js";
import { createHostedJest, type ProcessHost } from "../runner-host/process-host.js";
import type { AbsolutePath, ProjectName } from "../types/common.js";
import type { JestProject } from "../types/policy-jest.js";
import { type ContainerGuardOptions, createContainerGuardRunner } from "./container-guard.js";
import { hosted } from "./node-test-runners.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";
import { createRunnerSet, type RunnerSet } from "./runner-set.js";

/**
 * Where one worktree's Jest project keeps the wrapper config and Jest's
 * transform cache (spec 028 D4.1): under Squeal's state directory, so a warm
 * cache outlives the daemon's temp directory.
 */
export function jestCacheDir(
  stateDir: AbsolutePath,
  root: AbsolutePath,
  project: ProjectName,
): AbsolutePath {
  const id = createHash("sha256").update(`${root}\0${project}`).digest("hex").slice(0, 16);
  return join(stateDir, "jest", id) as AbsolutePath;
}

export interface JestRunnersOptions {
  readonly root: AbsolutePath;
  /** Squeal's state directory, `<common-dir>/squeal/`: each project's Jest cache goes under it. */
  readonly stateDir: AbsolutePath;
  /** Spec 001 D10: the daemon's temp directory, the children's `TMPDIR`. */
  readonly tempDir: AbsolutePath;
  /** Spec 001 D12: the mark the daemon's sweep finds a test's leftovers by. */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Policy `runner.tierSize`, read per run. */
  readonly tierSize: () => number;
  /** Policy `observe.runtimeInputs`, read per call. */
  readonly observe: () => boolean;
  /** A note, with the topic that replaces the project's earlier note on it. */
  readonly note: (text: string, topic?: string) => void;
  /** Spec 021 D8: each project's adapter in a runner host; absent, in this process. */
  readonly host?: ProcessHost | undefined;
  /** Spec 021 D20: how long a host stays up with no call; absent, for good. */
  readonly idleMs?: () => number;
}

/**
 * One runner per `jest` entry (spec 028 D6.1), each behind
 * `createRecoveringRunner` as node:test's and pytest's are: reading the
 * project waits for the first call or `open()`. No Jest, an unsupported one,
 * a config that does not read and a graph that cannot be built are handled
 * inside the adapter, so each costs that project's checks only and never
 * rejects a composite call. No remote lane yet: Jest joins `REMOTE_RUNNERS`
 * in row 028-07 (D7).
 */
export function createJestRunners(
  projects: readonly JestProject[],
  options: JestRunnersOptions,
): RecoveringRunner[] {
  return projects.map((project) => jestRunner(project, options));
}

/** The runners of the live `jest` entries, which a reload reconciles (011 C10, row 011-78). */
export function createJestRunnerSet(
  projects: () => readonly JestProject[],
  options: JestRunnersOptions,
): RunnerSet<RecoveringRunner> {
  return createRunnerSet(projects, (project) => jestRunner(project, options));
}

function jestRunner(project: JestProject, options: JestRunnersOptions): RecoveringRunner {
  const { batchSize } = project;
  const traits = jestTraits({ tierSize: options.tierSize, batchSize: () => batchSize });
  // Spec 027 D4.2: a container project never runs on this host or remotely.
  if (project.container !== undefined) {
    return createContainerGuardRunner({
      // `container-guard.ts` (row 027-06's) lists node:test and pytest; it reads the runner as a
      // name and a note topic only.
      runner: "jest" as ContainerGuardOptions["runner"],
      adapterVersion: JEST_ADAPTER_VERSION,
      root: options.root,
      project: { name: project.name, container: project.container },
      traits,
      note: options.note,
    });
  }
  // A host reads the files per batch from the project, as here (`HostedJestOptions`).
  const adapterOptions = {
    root: options.root,
    note: options.note,
    concurrency: options.tierSize,
    observe: options.observe,
    tempDir: options.tempDir,
    cacheDir: jestCacheDir(options.stateDir, options.root, project.name),
    ...(options.childEnv === undefined ? {} : { childEnv: options.childEnv }),
  };
  const { host } = options;
  return createRecoveringRunner({
    name: "jest",
    adapterVersion: JEST_ADAPTER_VERSION,
    create: () =>
      host === undefined
        ? createJestAdapter(project, {
            ...adapterOptions,
            ...(batchSize === undefined ? {} : { batchSize: () => batchSize }),
          })
        : createHostedJest(host, project, adapterOptions),
    // Spec 021 D7: a host that exited or missed a deadline is replaced; D20: an idle one closes.
    ...(host === undefined ? {} : hosted(options.idleMs)),
    traits,
    onFailure: (text) => options.note(`${text} (jest project ${JSON.stringify(project.name)})`),
    onRecovered: () => options.note(`jest project ${JSON.stringify(project.name)} started`),
  });
}
