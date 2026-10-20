import { type Ran, withheldForTouch } from "../../../../src/core/scheduler/stability.js";
import type { RelativePath, RunReport } from "../../../../src/core/types/index.js";

/*
 * `barrier.ts` at a tree before row 011-47, whose `Scheduler.#record` narrows
 * the barrier to the files whose keys name a touched path itself (task
 * 013-02): that narrowing, as the scheduler wrote it, then the tree's
 * `withheldForTouch`. It goes once the last release carries the move.
 */

export function barredByTouch<T extends Ran & { readonly inputs: readonly RelativePath[] }>(
  report: RunReport,
  files: readonly T[],
  touched: readonly RelativePath[],
  growth?: ReadonlyMap<string, { readonly growth: readonly RelativePath[] }>,
): { readonly report: RunReport; readonly barred: T[]; readonly paths: RelativePath[] } {
  const isTouched = new Set(touched);
  const named = (paths: readonly RelativePath[] = []) => paths.filter((p) => isTouched.has(p));
  const touchedOf = (ran: T) => [...named(ran.inputs), ...named(growth?.get(ran.file.id)?.growth)];
  const barred = files.filter((ran) => touchedOf(ran).length > 0);
  const paths = [...new Set(barred.flatMap(touchedOf))].sort();
  const withheld = withheldForTouch(
    report,
    paths,
    barred.map(({ file }) => file.ref),
  );
  return { report: withheld, barred, paths };
}
