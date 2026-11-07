import type { NodeTestProject } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import {
  type Harness,
  type HarnessOptions,
  openHarness as openVitestHarness,
} from "./vitest-harness.js";

export interface NodeTestHarnessOptions
  extends Omit<HarnessOptions, "nodeTest" | "nodeTestTierSize"> {
  /** node:test projects beside Vitest, behind the daemon's composite (spec 003 D7), before `parts`'. */
  readonly nodeTest?: readonly NodeTestProject[];
  /** Their processes at once follow policy `runner.tierSize`, as the daemon's adapters do (task 004-37). */
  readonly nodeTestTierSize?: boolean;
}

/** `vitest-harness.ts`'s `openHarness`, with node:test adapters beside the Vitest one. */
export async function openHarness(
  root: string,
  store: Store,
  commonDir: string,
  options: NodeTestHarnessOptions = {},
): Promise<Harness> {
  const { nodeTest = [], nodeTestTierSize, parts, ...rest } = options;
  return openVitestHarness(root, store, commonDir, {
    ...rest,
    parts: async (context) => [
      ...(await Promise.all(
        nodeTest.map((project) =>
          createNodeTestAdapter(project, {
            root: context.root,
            note: context.note,
            ...(nodeTestTierSize === true
              ? { concurrency: () => context.policy()?.runner.tierSize ?? 1 }
              : {}),
          }),
        ),
      )),
      ...((await parts?.(context)) ?? []),
    ],
  });
}
