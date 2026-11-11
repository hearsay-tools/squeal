import { WidthAnswers, type WidthTable } from "../../runners/vitest/width.js";
import type { AbsolutePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { NodeTestProject, PytestProject } from "../types/policy.js";
import type { AdapterHooks, HostedAdapter } from "./host.js";
import type { HostStart, ProcessHostOptions } from "./protocol.js";

/*
 * Spec 021 D6 to D8 (rows 021-11, 021-12): per runner, how the host builds
 * the project's own adapter from `start`, and how the daemon's proxy answers
 * the synchronous members from the values the host sends. node:test and
 * pytest answer none: their widths are the daemon's `runner.tierSize`.
 */

/**
 * The project's adapter for `start.runner` over `root`, its function options
 * reading the policy the daemon sent last, its callbacks the host's events.
 */
export async function buildAdapter(
  root: AbsolutePath,
  start: HostStart,
  hooks: AdapterHooks,
): Promise<HostedAdapter> {
  switch (start.runner) {
    case "vitest": {
      const { createVitestAdapter } = await import("../../runners/vitest/index.js");
      const { coverage, childEnv, maxWorkers } = start.options;
      return createVitestAdapter({
        root,
        note: hooks.note,
        optimizer: hooks.optimizer,
        observe: () => hooks.policy().observe,
        excludeProjects: () => hooks.policy().excludeProjects,
        exclude: () => hooks.policy().exclude,
        childEnv,
        ...(coverage === undefined
          ? {}
          : {
              coverage: {
                enabled: () => hooks.policy().coverage,
                children: () => hooks.policy().coverageChildren,
                provider: coverage.provider,
                tempDir: coverage.tempDir,
                collected: hooks.coverage,
              },
            }),
        ...(maxWorkers === undefined ? {} : { maxWorkers }),
      });
    }
    case "node-test": {
      const { createNodeTestAdapter } = await import("../../runners/node-test/adapter.js");
      const data = processOptions(start);
      return createNodeTestAdapter(data.project as NodeTestProject, {
        root,
        note: hooks.note,
        childEnv: start.options.childEnv,
        ...perRun(start, hooks),
        ...(start.policy.inputs === undefined ? {} : { inputs: () => hooks.policy().inputs ?? [] }),
        ...(data.tempDir === undefined ? {} : { tempDir: data.tempDir as AbsolutePath }),
        ...(data.coverage === true
          ? {
              coverage: {
                enabled: () => hooks.policy().coverage,
                children: () => hooks.policy().coverageChildren,
                collected: hooks.coverage,
              },
            }
          : {}),
      });
    }
    case "pytest": {
      const { createPytestAdapter } = await import("../../runners/pytest/adapter.js");
      const data = processOptions(start);
      const project = data.project as PytestProject;
      const { batchSize } = project;
      // The store's latest note of each topic, as the daemon's `latestNote` reads it: what
      // the daemon sent, then each note sent on the topic, which the daemon stores.
      const latest = new Map(Object.entries(data.latestNotes ?? {}));
      return createPytestAdapter(project, {
        root,
        note: (text, topic) => {
          if (topic !== undefined) latest.set(topic, text);
          hooks.note(text, topic);
        },
        latestNote: (topic) => latest.get(topic),
        childEnv: start.options.childEnv,
        ...perRun(start, hooks),
        ...(batchSize === undefined ? {} : { batchSize: () => batchSize }),
        ...(data.tempDir === undefined ? {} : { tempDir: data.tempDir as AbsolutePath }),
        ...(data.cacheDir === undefined ? {} : { cacheDir: data.cacheDir as AbsolutePath }),
      });
    }
    default:
      throw new Error(`runner host: no runner ${String(start.runner)}`);
  }
}

/** node:test's or pytest's data from `start`. */
function processOptions(start: HostStart): ProcessHostOptions {
  const data = start.options.process;
  if (data === undefined) throw new Error(`runner host: no project for ${start.runner}`);
  return data;
}

/** `concurrency`, read per run from the policy, when the daemon gives one at `start`. */
function perRun(start: HostStart, hooks: AdapterHooks): { concurrency?: () => number } {
  const first = start.policy.tierSize;
  if (first === undefined) return {};
  return { concurrency: () => hooks.policy().tierSize ?? first };
}

/** The width questions a proxy answers at once (`RunnerAdapter.slowWidth`, `tierWidth`). */
export interface Widths {
  slowWidth(testFiles: readonly TestFileRef[]): number;
  tierWidth(testFile: TestFileRef, grant: number): number;
}

/** The answers to the width questions from a host's `HostValues.widths`; `null`, the defaults. */
export function widthsOf(widths: unknown): Widths | null {
  if (widths === null || typeof widths !== "object") return null;
  const answers = new WidthAnswers(widths as WidthTable);
  return {
    slowWidth: (testFiles) => answers.atOnce(testFiles),
    tierWidth: (testFile, grant) => answers.of(testFile.project, grant),
  };
}
