// Throwaway research probe. No daemon, store, watcher or test runner is started.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism, cpus, loadavg } from "node:os";
import type { SchedulerContext } from "../../../src/core/scheduler/context.js";
import { newFileState } from "../../../src/core/scheduler/files.js";
import type { Ledger } from "../../../src/core/scheduler/ledger.js";
import { priorityOf, RunQueue } from "../../../src/core/scheduler/queue.js";
import { isCatchUp } from "../../../src/core/scheduler/revision.js";
import { slowFiles } from "../../../src/core/slow/classify.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../src/core/types/policy.js";

const start = performance.now();
console.log(
  JSON.stringify({
    time: new Date().toISOString(),
    node: process.version,
    version: JSON.parse(readFileSync("package.json", "utf8")).version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    cpus: cpus().length,
    available: availableParallelism(),
    load: loadavg(),
  }),
);
if (loadavg()[0] > cpus().length) {
  console.log("SKIPPED: one-minute load exceeds CPU count");
  process.exit(0);
}

const edited: TestFileRef[] = Array.from({ length: 35 }, (_, i) => ({
  project: "unit",
  path: `packages/web/src/components/unit-${i}.test.ts`,
}));
const firstEdited = edited[0];
assert.ok(firstEdited);
const transitive: TestFileRef = { project: "unit", path: "test/other.test.ts" };
const e2e: TestFileRef = { project: "e2e", path: "packages/web/e2e/activity.e2e.ts" };
const files = [...edited, transitive, e2e].map(newFileState);
// Only the classifier's reads are supplied. No key computation is simulated.
const context = {
  keys: {
    isDeclaredInput: () => false,
    index: { reverse: { referencing: () => [] } },
  },
} as unknown as SchedulerContext;
const ledger = { files: new Map(files.map((file) => [file.id, file])) } as unknown as Ledger;
const classify = (paths: string[]) => isCatchUp(context, ledger, new Set(paths));
for (const n of [9, 10, 35]) {
  const catchUp = classify(edited.slice(0, n).map((ref) => ref.path));
  assert.equal(catchUp, n >= 10);
  console.log(JSON.stringify({ changedListedTests: n, catchUp }));
}
const split = Array.from({ length: 5 }, (_, i) =>
  classify(edited.slice(i * 7, i * 7 + 7).map((ref) => ref.path)),
);
assert.deepEqual(split, [false, false, false, false, false]);
console.log(JSON.stringify({ fiveRevisionsOfSevenTests: split }));
const mixed = classify([
  ...edited.slice(0, 9).map((ref) => ref.path),
  ...Array.from({ length: 26 }, (_, i) => `unkeyed-${i}.md`),
]);
assert.equal(mixed, false);
console.log(JSON.stringify({ changedPaths: 35, keyedPaths: 9, catchUp: mixed }));

const changed = new Set(edited.map((ref) => ref.path));
// Synthetic durations: edited tests 100 ms, transitive test 1 ms, e2e 2 ms.
// These are ordering inputs, not measured runtimes.
const duration = (ref: TestFileRef) => (ref === transitive ? 1 : ref === e2e ? 2 : 100);
function queue(catchUp: boolean, slow: boolean) {
  const result = new RunQueue();
  result.setPromotionClock(
    () => 1000,
    () => false,
  );
  result.setSlow(
    slowFiles(
      {
        ...DEFAULT_POLICY,
        slow: { ...DEFAULT_POLICY.slow, include: slow ? ["packages/web/e2e/**"] : [] },
      },
      [],
    ),
  );
  // All files are assumed re-keyed and reached. Ledger.settle's actual bridge
  // uses reached && !catchUp for recent, and reached && catchUp for catch-up.
  // Calling that bridge or establishing this closure is outside this probe.
  for (const file of files)
    result.add(file.ref, priorityOf(file, changed), false, !catchUp, catchUp);
  return result;
}
const catchUp = classify([...changed]);
const q = queue(catchUp, false);
assert.equal(q.isCatchUp(firstEdited), true);
assert.deepEqual(q.ordered(duration).slice(0, 2), [transitive, e2e]);
console.log(
  JSON.stringify({
    case: "35 edits, unmarked e2e",
    first: q
      .ordered(duration)
      .slice(0, 3)
      .map((ref) => ref.path),
    editedRank: q.ordered(duration).indexOf(firstEdited) + 1,
    catchUp: q.isCatchUp(firstEdited),
  }),
);
const small = queue(false, false);
assert.deepEqual(small.ordered(duration).slice(0, 35), edited);
console.log(
  JSON.stringify({
    case: "edit class control",
    editedRank: small.ordered(duration).indexOf(firstEdited) + 1,
  }),
);
const unknownEdited = (ref: TestFileRef) => (changed.has(ref.path) ? null : duration(ref));
assert.equal(q.ordered(unknownEdited).indexOf(firstEdited) + 1, 3);
assert.equal(small.ordered(unknownEdited).indexOf(firstEdited) + 1, 1);
console.log(JSON.stringify({ case: "unknown edited durations", catchUpRank: 3, editRank: 1 }));
const marked = queue(catchUp, true);
assert.equal(marked.ordered(duration).includes(e2e), false);
assert.equal(marked.slowSize, 1);
console.log(
  JSON.stringify({
    case: "e2e marked slow",
    fast: marked.fastSize,
    slow: marked.slowSize,
    e2eInFastOrder: false,
  }),
);
q.promote([firstEdited], 121000);
assert.equal(q.ordered(duration)[0], edited[0]);
console.log(
  JSON.stringify({
    case: "named promotion",
    editedRank: q.ordered(duration).indexOf(firstEdited) + 1,
    catchUp: q.isCatchUp(firstEdited),
  }),
);
const prior = queue(catchUp, false);
prior.add(firstEdited, 1, false, true, false);
prior.add(firstEdited, 1, false, false, true);
assert.equal(prior.isRecent(firstEdited), true);
assert.equal(prior.isCatchUp(firstEdited), false);
console.log(
  JSON.stringify({ case: "previous recent survives catch-up add", recent: true, catchUp: false }),
);
console.log(
  JSON.stringify({ assertions: "PASS", elapsedMs: Math.round(performance.now() - start) }),
);
