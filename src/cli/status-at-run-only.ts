import type { GateAdapters } from "../core/code/gate/runners.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { RunnerAdapter } from "../core/types/runner.js";

/*
 * Row 023-29 (review wave-18 B3): one batch of `--run` runs only its own
 * test files, by project and path. The gate runs a named path under every
 * project that lists it, so a path an ordinary project and a manual one
 * share put the manual project, and its global setup, into the ordinary
 * batch. Through the gate's own `adapters` option, each runner here lists
 * only the batch's files: the gate selects nothing else, and Vitest starts
 * no project, nor its global setup, that has no file in the run. Keys,
 * stores and each project's completion record stay the gate's.
 */

/** `adapters`, each runner listing only `refs` of the ones it lists. */
export function onlyThese(adapters: GateAdapters, refs: readonly TestFileRef[]): GateAdapters {
  const ids = new Set(refs.map(testFileId));
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "testFiles") return value.bind(target);
        return async () => (await target.testFiles()).filter((ref) => ids.has(testFileId(ref)));
      },
    });
  return {
    vitest: async (options) => wrap(await adapters.vitest(options)),
    nodeTest: async (project, options) => wrap(await adapters.nodeTest(project, options)),
  };
}
