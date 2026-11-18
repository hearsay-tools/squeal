// Throwaway research probe: synthetic records, real classifiers; no daemon or runner.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpus, loadavg } from "node:os";
import { noVerdictText, verdictCode } from "../../../../../../src/cli/verdict.js";
import { testTally } from "../../../../../../src/core/commit/compute.js";
import { commitReportText } from "../../../../../../src/core/commit/text.js";
import type { SchedulerContext } from "../../../../../../src/core/scheduler/context.js";
import { demote, editWork, fetchEditCut } from "../../../../../../src/core/scheduler/edit-cut.js";
import { newFileState } from "../../../../../../src/core/scheduler/files.js";
import type { Ledger } from "../../../../../../src/core/scheduler/ledger.js";
import { priorityOf, RunQueue } from "../../../../../../src/core/scheduler/queue.js";
import { BacklogQuiet } from "../../../../../../src/core/scheduler/quiet.js";
import { isCatchUp } from "../../../../../../src/core/scheduler/revision.js";
import type { RunnerPartBound } from "../../../../../../src/core/scheduler/runner-work-bound.js";
import type { TestFileRef } from "../../../../../../src/core/types/keys.js";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/policy.js";

const start = performance.now();
const emit = (value: unknown) => console.log(JSON.stringify(value));
emit({
  time: new Date().toISOString(),
  node: process.version,
  cpus: cpus().length,
  load: loadavg(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
});
if (loadavg()[0] > cpus().length) {
  emit({ skipped: "load exceeds CPU count" });
  process.exit(0);
}
const source = "src/agent-profiles.ts";
const target: TestFileRef = { project: "unit", path: "src/provider-auth.test.ts" };
const fast = Array.from({ length: 4 }, (_, i) => ({
  project: "unit",
  path: `src/fast-${i}.test.ts`,
}));
const broad: TestFileRef = { project: "unit", path: "test/declared-only.test.ts" };
const refs = [...fast, target, broad];
const files = refs.map(newFileState);
for (const file of files) {
  file.durationMs = file.ref === target ? 100 : 1;
  file.resultKey = "old";
}
const context = {
  policy: { ...DEFAULT_POLICY, runner: { ...DEFAULT_POLICY.runner, tierSize: 4 } },
  keys: {
    isDeclaredInput: () => false,
    declaredFor: (path: string) => (path === broad.path ? [source] : []),
    observedOf: () => [],
    index: { reverse: { referencing: () => refs } },
  },
} as unknown as SchedulerContext;
const queue = new RunQueue({ now: () => 1000, isRunning: () => false });
const ledger = {
  files: new Map(files.map((f) => [f.id, f])),
  queue,
  recentOf: () => new Set(files.map((f) => f.id)),
} as unknown as Ledger;
const changed = new Set([source]);
const affected = { direct: [], transitive: [...fast, target] };
// The supplied graph classification is synthetic, not a measured Vitest graph.
const cut = await fetchEditCut(context, refs, [source], affected, {} as RunnerPartBound);
const work = editWork(context, ledger, cut, changed, new Set());
assert.equal(work.kept.size, 4);
const targetFile = files.find((f) => f.ref === target)!;
assert.equal(work.kept.has(targetFile.id), false);
for (const file of files) queue.add(file.ref, priorityOf(file, changed), false, true, false, 2);
demote(ledger, work.reached, work.kept, 2);
const duration = (ref: TestFileRef) => files.find((f) => f.ref === ref)?.durationMs ?? null;
const order = queue.ordered(duration).map((f) => f.path);
assert.equal(queue.isCatchUp(target), true);
assert.ok(order.indexOf(broad.path) < order.indexOf(target.path));
emit({
  case: "one changed source; four shorter transitive dependents",
  catchUpRevision: isCatchUp(context, ledger, changed),
  kept: [...work.kept],
  targetCatchUp: queue.isCatchUp(target),
  order,
});
const direct = new Set([targetFile.id]);
const directCut = await fetchEditCut(
  context,
  refs,
  [source],
  { direct: [target], transitive: fast },
  {} as RunnerPartBound,
);
assert.equal(editWork(context, ledger, directCut, changed, direct).kept.has(targetFile.id), true);
emit({ case: "direct importer fallback control", targetKept: true });
const bulk = new Set(Array.from({ length: 10 }, (_, i) => `src/keyed-${i}.ts`));
assert.equal(isCatchUp(context, ledger, bulk), true);
emit({ case: "ten keyed paths control", catchUpRevision: true });
queue.promote([target], 61_000);
assert.equal(queue.ordered(duration)[0], target);
emit({ case: "named test promotion control", targetRank: 1 });
const quiet = new BacklogQuiet();
quiet.caughtUp("unit", 0);
for (let now = 60_000; now <= 180_000; now += 60_000) quiet.queued("unit", now);
assert.equal(quiet.catchUpWaits("unit", 299_999), true);
assert.equal(quiet.catchUpWaits("unit", 300_000), false);
emit({
  case: "virtual quiet clock",
  queuedAt: [60_000, 120_000, 180_000],
  catchUpWaitEnds: 300_000,
});
const record = {
  worktreeId: "probe",
  testFile: target,
  key: "new",
  revision: 2,
  pending: "queued" as const,
};
const view = {
  closure: () => [target.path, source],
  isEnvironmentInput: () => false,
  testFiles: () => [record],
  states: () => [],
};
for (const asked of [false, true]) {
  const { counts } = testTally(view, { differing: new Set(), asked: () => asked });
  const text = commitReportText({ commit: "1234567", revision: 2, at: 0, tests: counts });
  assert.equal(counts.running, asked ? 1 : 0);
  assert.equal(counts.unknown, 0);
  emit({ case: "pending file with no result", askedByCommit: asked, counts, text });
}
const exact = commitReportText({
  commit: "301fc63",
  revision: 2,
  at: 0,
  tests: { files: 1230, failures: 0, notDetermined: 6, untracked: 6, running: 0, unknown: 124 },
  lint: { findings: 0, running: 2, notDetermined: 0 },
});
assert.equal(
  exact,
  "Commit 301fc63: 0 known failures; lint 0 findings, 2 files still running; 6 test files not determined (untracked files); 124 test files unknown",
);
emit({ case: "reported summary counts", text: exact });
const verdict = {
  revision: 2,
  testFiles: 1230,
  byClass: { current: 1106, pending: 0, stale: 0, unknown: 124 },
  unlisted: false,
  failures: { tests: 0, testFiles: 0 },
};
assert.equal(verdictCode(verdict), 3);
emit({
  case: "wait verdict with unknown",
  exitCode: verdictCode(verdict),
  reason: noVerdictText(verdict),
});
emit({ assertions: "PASS", elapsedMs: Math.round(performance.now() - start) });
