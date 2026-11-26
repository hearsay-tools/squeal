import { resolveCommonDir } from "../fs/git-layout.js";
import {
  consentSettingsNote,
  containerConsentFor,
  isTargetConsented,
  loadContainerConsent,
  unconsentedNote,
} from "../runner-host/container/consent.js";
import type { AbsolutePath } from "../types/common.js";
import type { RunnerAdapter, RunReport } from "../types/runner.js";
import type { RunnerTraits } from "../types/runner-traits.js";
import { createRecoveringRunner, type RecoveringRunner } from "./runner.js";

/*
 * Spec 027 D4.2 (row 027-04, review 0.1.643 B1): a project with a
 * `container` runs in that target, never on this host and never on a
 * remote lane. Until row 027-06 routes it to the container manager, its
 * runner lists no file, starts no process, answers an unavailable
 * environment and writes one note: the consent `squeal setup` gives, or,
 * with consent, that container execution is not in this version. Reading
 * consent never starts `docker`.
 */

export interface ContainerGuardOptions {
  readonly runner: "node-test" | "pytest";
  readonly adapterVersion: string;
  readonly root: AbsolutePath;
  readonly project: { readonly name: string; readonly container: string };
  readonly traits: RunnerTraits;
  readonly note: (text: string, topic?: string) => void;
  /** The process environment `containers.json` is found by; absent, this process's. */
  readonly env?: NodeJS.ProcessEnv;
}

/** The note topic of a guarded project, which replaces its earlier note. */
export function containerGuardTopic(runner: string, project: string): string {
  return `container-guard:${runner}:${project}`;
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
    ? `project ${JSON.stringify(project)} runs in container target ${JSON.stringify(target)}, which this machine allows, but this version of Squeal does not run container targets yet: its files stay unknown and never run on this host`
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
      return { recreatedProjects: [] };
    },
    async recheck() {
      check();
      return { recreatedProjects: [] };
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
  return createRecoveringRunner({
    name: runner,
    adapterVersion: options.adapterVersion,
    create: async () => {
      check();
      return adapter;
    },
    traits: options.traits,
    onFailure: (text) =>
      options.note(`${text} (${runner} project ${JSON.stringify(project.name)})`),
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
