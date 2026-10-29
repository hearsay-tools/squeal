import { expect, it } from "vitest";
import { StatCache } from "../../../../../../src/core/hash/index.js";
import type { SchedulerContext } from "../../../../../../src/core/scheduler/context.js";
import { Ledger } from "../../../../../../src/core/scheduler/ledger.js";
import { Priority } from "../../../../../../src/core/scheduler/queue.js";
import { NONE_CUT } from "../../../../../../src/core/scheduler/sharing.js";
import { selectTier } from "../../../../../../src/core/scheduler/tiers.js";
import { createStateSink } from "../../../../../../src/core/state/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type RunnerAdapter,
  type TestFileRef,
  type WorktreeId,
} from "../../../../../../src/core/types/index.js";
import { liveDaemon } from "../../../../../../test/delivery/fakes.js";
import { freshStore } from "../../../../../../test/state/helpers.js";

// Throwaway research fixture, reduced from test/scheduler/promoted-tier-select.test.ts.
// Real queue, selector and SQLite; synthetic files, clock and runner, no CPU pool.
const WT = "wt-issue-125" as WorktreeId;

function setup(runner: Partial<RunnerAdapter> = {}) {
  const store = freshStore();
  liveDaemon(store, WT);
  const at = { now: 1_000_000 };
  const context = {
    root: "/repo/wt-011-265",
    store,
    sink: createStateSink(store),
    worktreeId: WT,
    policy: DEFAULT_POLICY,
    now: () => at.now,
    note: () => {},
    runsDir: "/repo/.git/squeal/runs",
    hostLoad: () => ({ oneMinute: null, cpus: 1 }),
    runner,
    keys: {
      runnerOf: () => undefined,
      runtimeIdentity: () => "",
      writeRuntimeApplications: () => {},
      index: { key: () => null, keysReadAsOne: () => null },
      cache: new StatCache(),
      stabilityPaths: () => [],
      beginRun: () => 1,
      endRun: () => {},
    },
  } as unknown as SchedulerContext;
  return { ledger: new Ledger(context), context, at, store };
}

/** Queues `paths`, each at a key of its own: an edit's work when `recent`, else the backlog. */
function queue(ledger: Ledger, paths: readonly string[], recent = false): TestFileRef[] {
  return paths.map((path) => {
    const ref = { project: "", path };
    const file = ledger.addFile(ref);
    file.key = Buffer.from(path).toString("hex").padEnd(64, "0") as CheckKey;
    ledger.enqueue(file, recent ? Priority.edited : Priority.transitive, false, recent);
    return ref;
  });
}

const paths = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `test/${prefix}${String(i).padStart(2, "0")}.test.ts`);
const pathsOf = (refs: readonly TestFileRef[]) => refs.map((ref) => ref.path);

function picked(context: SchedulerContext, ledger: Ledger, turnDue?: boolean) {
  const tier = selectTier(context, ledger, new Set(), NONE_CUT, turnDue);
  return {
    kind: tier?.kind ?? null,
    promoted: tier?.promoted ?? false,
    files: tier?.files.map((f) => f.file.ref.path).sort() ?? [],
  };
}

// Throwaway research: exercise whole-file selection, never focused rows.
it.each([false, true])("12 whole files, edit work queued = %s", (edit) => {
  const { ledger, context, at } = setup();
  queue(ledger, paths("backlog", 3));
  const named = queue(ledger, paths("named", 12));
  if (edit) queue(ledger, ["test/edit.test.ts"], true);
  ledger.queue.promote(named, at.now + 60_000);
  const first = picked(context, ledger);
  console.log(JSON.stringify({ probe: "whole-files", edit, ...first }));
  expect(first.kind).toBe(edit ? "edit" : "backlog");
  expect(first.promoted).toBe(!edit);
  expect(first.files).toEqual(pathsOf(named).slice(0, edit ? 4 : 12));
});
