import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFsHasher, seedStatCache } from "../../../../src/core/hash/hasher.js";
import { StatCache } from "../../../../src/core/hash/stat-cache.js";
import {
  decisionOf,
  recordOutcome,
  runEnd,
} from "../../../../src/core/run-evidence/run-evidence.js";
import { observedMoves } from "../../../../src/core/run-evidence/sources.js";
import type { SchedulerContext } from "../../../../src/core/scheduler/context.js";
import { Withholds } from "../../../../src/core/scheduler/stability.js";
import type { AbsolutePath, RelativePath } from "../../../../src/core/types/common.js";
import type { CaseOutput, StoreInput } from "../case.js";
import { git, writeTree } from "./shared.js";
import { entriesOf, named } from "./store.js";
import { observationsOf, reportOf } from "./store-input.js";

/*
 * Row 011-321 (review 0.1.453-r2 N1): a `store` case with `reads`. The
 * files' growth paths are written and hashed into a stat cache, as
 * `prepareObserved` leaves them; then `reads.changed` get new bytes and
 * `reads.touched` only a later `mtime`. The record checks them as the
 * daemon's does (`observedMoves`), and its touched reads reach the barrier
 * (`recordOutcome`), its changed ones the decision (`runEnd`, `decisionOf`).
 * Nothing is withheld before, nothing is held and the install holds still.
 */

type Reads = NonNullable<StoreInput["reads"]>;

/** What recording `input`'s tier decides for each file once its observed reads moved as `reads` says. */
export async function storeReads(
  input: StoreInput,
  reads: Reads,
  scratch: string,
): Promise<CaseOutput> {
  const paths = [...new Set(input.files.flatMap((f) => f.growth?.growth ?? []))].sort();
  const root = writeTree(
    join(scratch, "repo"),
    Object.fromEntries(paths.map((path) => [path, `read ${path}\n`])),
  ) as AbsolutePath;
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  const cache = new StatCache();
  await seedStatCache(cache, root, paths as RelativePath[], { objectFormat: "sha1" });
  const later = new Date(Date.now() + 60_000);
  for (const path of reads.changed) writeFileSync(join(root, path), `changed ${path}\n`);
  for (const path of [...reads.changed, ...reads.touched]) {
    utimesSync(join(root, path), later, later);
  }
  const context = { keys: { cache }, hasher: createFsHasher(root, "sha1") };
  const observed = await observedMoves(
    context as unknown as Pick<SchedulerContext, "keys" | "hasher">,
    new Map(observationsOf(input).growth),
  );
  const files = entriesOf(input);
  const ran = files.map((f) => ({
    ...f,
    entry: { ...f.entry, checkpointId: null, forced: false },
  }));
  const entries = ran.map(({ entry }) => entry);
  const withholds = new Withholds();
  const outcome = recordOutcome(
    entries,
    reportOf(input),
    { touched: [...observed.touched].sort(), observed },
    {
      held: [],
      startupHeld: false,
      withholds: (barred) => withholds.peek(barred),
      unfinished: [],
      notStarted: [],
      interrupted: [],
      installMoved: false,
    },
  );
  const end = runEnd(
    { files: entries, lane: "", changes: new Set(), cancel: null },
    outcome.report,
    new Set(),
    outcome.requeue,
    observed,
  );
  const decided = ran.map(({ f, keys, entry }) => {
    const { decision, reason } = decisionOf(entry, end, outcome, true);
    return { f, keys, decision, reason };
  });
  return {
    outputs: {
      decisions: decided.map(({ f, keys, decision: d }) => ({
        path: f.path,
        decision: named(d, keys),
        grown: "growth" in d && d.growth !== undefined,
        current: d.kind === "store" && d.current,
      })),
    },
    wording: {
      changed: [...observed.changed].sort(),
      touched: [...observed.touched].sort(),
      reasons: decided.map(({ f, reason }) => `${f.path}: ${reason}`),
    },
  };
}
