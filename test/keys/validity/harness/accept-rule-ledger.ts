import type { SchedulerContext } from "../../../../src/core/scheduler/context.js";
import { Ledger } from "../../../../src/core/scheduler/ledger.js";
import type {
  CheckId,
  CheckKey,
  ResultRecord,
  TestFileRef,
} from "../../../../src/core/types/index.js";
import type { Accepted } from "./accept-rule.js";

/*
 * The accept rule at a tree that keeps it in `Ledger` (task 011-37 section
 * 5), the last release's until it carries row 011-40's move: `probe`, and
 * the checks `applyResults` retires when the hits become the file's
 * results, read from the sink's `retire` at the next commit. The bundle
 * reads it for `accept-rule.ts` at a tree without `accept.ts` (`bundle.ts`).
 */

type Probe = { readonly hits: readonly ResultRecord[]; readonly mayWait: boolean };

/** `context`'s lookup of `key` for `testFile`, whose current results hold `current`. */
export function acceptRule(
  context: SchedulerContext,
  testFile: TestFileRef,
  key: CheckKey,
  current: readonly CheckId[],
): Accepted {
  const retired: CheckId[] = [];
  const sink = {
    applyResults: () => {},
    markUnknown: () => {},
    retire: (_: unknown, checks: readonly CheckId[]) => retired.push(...checks),
    setupOutcome: () => {},
    refresh: () => {},
  };
  const ledger = new Ledger({ ...context, sink } as unknown as SchedulerContext);
  // Format 12's probe took the file's state first and read the policy's slow files (004-81).
  const probe =
    ledger.probe.length >= 2
      ? (ledger.probe as unknown as (file: unknown, key: CheckKey) => Probe).call(
          ledger,
          { ref: testFile },
          key,
        )
      : ledger.probe(key);
  if (probe.hits.length > 0) {
    const file = ledger.addFile(testFile);
    file.checks = [...current];
    ledger.applyResults(file, key, probe.hits, null);
    ledger.commit();
  }
  return { ...probe, retired };
}
