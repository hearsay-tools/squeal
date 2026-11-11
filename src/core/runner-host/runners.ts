import { WidthAnswers, type WidthTable } from "../../runners/vitest/width.js";
import type { AbsolutePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { AdapterHooks, HostedAdapter } from "./host.js";
import type { HostStart } from "./protocol.js";

/*
 * Spec 021 D6 to D8 (row 021-11): per runner, how the host builds the
 * project's own adapter from `start`, and how the daemon's proxy answers the
 * synchronous members from the values the host sends. Vitest first; node:test
 * and pytest follow by the same cut (row 021-12).
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
    default:
      throw new Error(`runner host: no runner ${String(start.runner)}`);
  }
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
