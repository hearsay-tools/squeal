import { resolveCommonDir } from "../fs/git-layout.js";
import {
  type ContainerConsent,
  consentSettingsNote,
  containerConsentFor,
  isTargetConsented,
  loadContainerConsent,
  unconsentedNote,
} from "../runner-host/container/consent.js";
import {
  type ContainerWiring,
  containerPaths,
  containerWorkDirs,
} from "../runner-host/container/index.js";
import type { ContainerPaths } from "../runner-host/container/manager.js";
import {
  containerHostGone,
  containerTopic,
  createContainerRunner,
} from "../runner-host/container/runner.js";
import type { HostAdapterOptions, HostPolicy } from "../runner-host/protocol.js";
import type { AbsolutePath } from "../types/common.js";
import type { RunnerAdapter, RunReport } from "../types/runner.js";
import type { RunnerTraits } from "../types/runner-traits.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";

/*
 * Spec 027 D4.2 (row 027-04, review 0.1.643 B1): a project with a
 * `container` runs in that target, never on this host and never on a
 * remote lane. Without consent for its target, its runner lists no file,
 * starts no process, runs no `docker`, answers an unavailable environment
 * and writes one note: the consent `squeal setup` gives. Row 027-06: with
 * consent and the daemon's container wiring, it runs in its managed
 * container (`runner-host/container/runner.ts`); consent without the
 * wiring still runs nothing. Consent is read again at each batch, and a
 * change of it starts the other route at the next call.
 */

/** A project's host adapter start in its container, from its mounted work directories. */
export type ContainerStart = (dirs: { readonly tempDir: string; readonly cacheDir: string }) => {
  readonly options: HostAdapterOptions;
  readonly policy: () => HostPolicy;
};

export interface ContainerGuardOptions {
  readonly runner: "node-test" | "pytest";
  readonly adapterVersion: string;
  readonly root: AbsolutePath;
  readonly project: { readonly name: string; readonly container: string };
  readonly traits: RunnerTraits;
  readonly note: (text: string, topic?: string) => void;
  /** The process environment `containers.json` is found by; absent, this process's. */
  readonly env?: NodeJS.ProcessEnv;
  /** Row 027-06: the daemon's container route; absent, a consented project stays unknown. */
  readonly containers?: ContainerWiring;
  /** The project's host start in the container; with `containers`, required to route. */
  readonly start?: ContainerStart;
}

/** The note topic of a guarded project, which replaces its earlier note. */
export function containerGuardTopic(runner: string, project: string): string {
  // The container route notes on the same topic, so one state's note replaces the other's.
  return containerTopic(runner, project);
}

/** This machine's consent for `target` of `root`, read from `env`; `null` when it allows none. */
export function consentFor(
  root: AbsolutePath,
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): ContainerConsent | null {
  const settings = loadContainerConsent(env);
  const found = containerConsentFor(settings, root, resolveCommonDir(root) ?? root);
  return isTargetConsented(found?.consent, target) ? (found?.consent ?? null) : null;
}

/** Why `project`, in `target`, does not run now, with consent read from `env`. */
export function containerGuardNote(
  root: AbsolutePath,
  project: string,
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const settings = loadContainerConsent(env);
  const found = containerConsentFor(settings, root, resolveCommonDir(root) ?? root);
  const problems = consentSettingsNote(settings);
  const text = isTargetConsented(found?.consent, target)
    ? `project ${JSON.stringify(project)} runs in container target ${JSON.stringify(target)}, which this machine allows, but this daemon does not run container targets yet (it has no container route): its files stay unknown and never run on this host`
    : unconsentedNote(project, target, settings.path);
  return problems === null ? text : `${text} (${problems})`;
}

/** A runner for a container-configured project that never runs its tests here or remotely. */
export function createContainerGuardRunner(options: ContainerGuardOptions): RecoveringRunner {
  const { project, runner } = options;
  const topic = containerGuardTopic(runner, project.name);
  let state = "";
  /** Reads consent again; notes when the state changed. Never starts `docker`. */
  const check = (): boolean => {
    const next = containerGuardNote(options.root, project.name, project.container, options.env);
    if (next === state) return false;
    state = next;
    options.note(next, topic);
    return true;
  };
  const adapter: RunnerAdapter = {
    name: runner,
    adapterVersion: options.adapterVersion,
    traits: options.traits,
    async invalidate() {
      check();
      switched = routable() !== null;
      // The next call starts the container route; the project is re-keyed under it.
      return { recreatedProjects: switched ? [project.name] : [] };
    },
    async recheck() {
      check();
      switched = routable() !== null;
      // The next call starts the container route; the project is re-keyed under it.
      return { recreatedProjects: switched ? [project.name] : [] };
    },
    affected: async () => ({ direct: [], transitive: [] }),
    async closure() {
      throw new Error(state);
    },
    enumerate: async () => [],
    testFiles: async () => [],
    environment: async () => [
      {
        project: project.name,
        runnerName: runner,
        runnerVersion: "unavailable",
        adapterVersion: options.adapterVersion,
        resolvedConfig: JSON.stringify({ container: project.container, unavailable: state }),
        files: [],
      },
    ],
    run: async () => unavailableReport(state),
    close: async () => {},
  };
  /** Consent and the target when the container route may run the project now; else `null`. */
  const routable = () => {
    const { containers, start } = options;
    const target = containers?.containers()[project.container];
    if (containers === undefined || start === undefined || target === undefined) return null;
    return consentFor(options.root, project.container, options.env) === null
      ? null
      : { containers, start, target };
  };
  let paths: ContainerPaths | null = null;
  let switched = false;
  return createRecoveringRunner({
    name: runner,
    adapterVersion: options.adapterVersion,
    create: async () => {
      switched = false;
      const route = routable();
      if (route === null) {
        check();
        status(options, "unconsented");
        return adapter;
      }
      state = "";
      const { containers, target } = route;
      paths ??= containerPaths(containers, options.root);
      return createContainerRunner({
        runner,
        adapterVersion: options.adapterVersion,
        traits: options.traits,
        worktreeId: containers.worktreeId,
        project: project.name,
        targetName: project.container,
        target,
        consent: () => consentFor(options.root, project.container, options.env),
        paths,
        squealCliPath: containers.squealCliPath,
        version: containers.version,
        start: route.start(containerWorkDirs(paths, project.name)),
        note: options.note,
        status: (next) => status(options, next),
        ...(containers.manager === undefined ? {} : { manager: containers.manager }),
        ...(containers.deadlines === undefined ? {} : { deadlines: containers.deadlines }),
        ...(containers.openChannel === undefined ? {} : { openChannel: containers.openChannel }),
      });
    },
    // A runner host gone is replaced; a guard whose project became routable gives way.
    gone: (current) => containerHostGone(current) || (current === adapter && switched),
    ...(options.containers?.idleMs === undefined ? {} : { idleMs: options.containers.idleMs }),
    traits: options.traits,
    onFailure: (text) =>
      options.note(`${text} (${runner} project ${JSON.stringify(project.name)})`),
  });
}

/** Tells the daemon `project`'s target state, when it listens. */
function status(
  options: ContainerGuardOptions,
  state: Parameters<NonNullable<ContainerWiring["status"]>>[0]["state"],
): void {
  const target = options.containers?.containers()[options.project.container];
  options.containers?.status?.({
    target: options.project.container,
    runner: options.runner,
    project: options.project.name,
    state,
    keyMode: target?.keyMode ?? "build-content",
  });
}

function unavailableReport(failure: string): RunReport {
  return {
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure,
  };
}
