import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import type { SchedulerContext } from "../../../../src/core/scheduler/context.js";
import { recordsForFile } from "../../../../src/core/scheduler/records.js";
import { stateFromResult } from "../../../../src/core/state/derive.js";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import { createStateSink } from "../../../../src/core/state/sink.js";
import type {
  ResultRecord,
  StateSink,
  Store,
  TestFileKeyRecord,
  WorktreeId,
} from "../../../../src/core/types/index.js";
import type { AcceptInput, CaseOutput } from "../case.js";
import { acceptRule } from "./accept-rule.js";
import { type Keyed, keyedOver } from "./keyed.js";
import {
  KEY,
  LISTED_KEY,
  provenance,
  REPORT,
  scratchStore,
  verdictOf,
  writeTree,
} from "./shared.js";

/*
 * The upgrade itself (011 C3; task 011-37 D1 a): each tree stores the same
 * runs under one key, as each run's own worktree does, with its own store
 * code. The candidate then decides over the store each tree wrote, as a
 * user's daemon opens a store an earlier release wrote, and the two
 * decisions are compared.
 */

/** The key the tree computes over `input.installed` (011-85 R4), else the fixed one. */
async function keyedFor(input: AcceptInput, scratch: string): Promise<Keyed | null> {
  if (input.installed === undefined) return null;
  return keyedOver(input.testFile, input.installed, join(scratch, "worktree"));
}

/**
 * Stores `input.runs` in a store under `scratch`, each applied to its own
 * worktree's states, then the receiver's timeout when `input.unknown` is set.
 */
export async function writeAccept(input: AcceptInput, scratch: string): Promise<CaseOutput> {
  const keyed = await keyedFor(input, join(scratch, "install"));
  keyed?.close();
  const store = scratchStore(join(scratch, "store"));
  try {
    const sink = createStateSink(store, { now: () => 2_000 });
    const stored: ResultRecord[] = [];
    for (const [at, run] of input.runs.entries()) {
      const records = recordsForFile({
        ref: input.testFile,
        key: keyed?.key ?? (input.readAsOne ? LISTED_KEY : KEY),
        report: { ...REPORT, completedFiles: [input.testFile], ...run.report },
        previousChecks: run.previousChecks ?? [],
        provenance: provenance(run.worktree, run.recordedAt, `run-${at}`),
        describe: describeFailure,
      });
      store.results.putMany(records);
      sink.applyResults(run.worktree as WorktreeId, 1, records, { checkpointId: null });
      stored.push(...records);
    }
    if (input.unknown !== undefined) timeOut(store, sink, input, stored, input.unknown);
    return {};
  } finally {
    store.close();
  }
}

/**
 * The receiver's lookup of the key over the store under `stored`: accepted
 * or held, the states its rows give, and the checks they retire. Over an
 * install, the key and the keys read as one are the tree's own.
 */
export async function decideAccept(
  input: AcceptInput,
  stored: string,
  scratch: string,
): Promise<CaseOutput> {
  const keyed = await keyedFor(input, join(scratch, "install"));
  const store = scratchStore(join(stored, "store"));
  try {
    const own = keyed?.key ?? KEY;
    const root = writeTree(join(scratch, "worktree"), {
      "squeal.config.json": JSON.stringify(input.policy ?? {}),
    });
    const worktreeId = input.receiver as WorktreeId;
    const context = {
      store,
      worktreeId,
      root,
      now: () => 3_000,
      policy: loadPolicy(root).policy,
      keys: {
        declaredFor: () => input.declared ?? [],
        cache: { hashOf: () => undefined },
        // From format 18 a miss reads the formats read as one first (011-38).
        index: keyed?.keys.index ?? {
          keysReadAsOne: () =>
            input.readAsOne ? { testFile: input.testFile, keys: [LISTED_KEY] } : null,
        },
      },
    } as unknown as SchedulerContext;
    const probe = acceptRule(context, input.testFile, own, input.current ?? []);
    const key: TestFileKeyRecord = {
      worktreeId,
      testFile: input.testFile,
      key: own,
      revision: 1,
      pending: null,
    };
    const states = probe.hits.map((hit) => {
      const state = stateFromResult(worktreeId, 1, hit, key, null);
      return {
        check: state.check,
        outcome: state.outcome,
        validity: state.validity,
        origin: state.origin?.kind ?? null,
        fingerprint: state.fingerprint,
      };
    });
    return {
      outputs: {
        accepted: probe.hits.map(verdictOf),
        mayWait: probe.mayWait,
        states,
        retired: probe.retired,
        ...(input.unknown === undefined ? {} : { unknown: unknownStates(store, worktreeId) }),
      },
    };
  } finally {
    store.close();
    keyed?.close();
  }
}

/**
 * The receiver's own timeout or crash after it took the runs' results
 * (011-59), with the tree's own code: its checks become unknown at its next
 * revision, and nothing is stored under the key.
 */
function timeOut(
  store: Store,
  sink: StateSink,
  input: AcceptInput,
  records: readonly ResultRecord[],
  reason: string,
) {
  const worktreeId = input.receiver as WorktreeId;
  sink.applyResults(worktreeId, 1, records, { checkpointId: null });
  const { number } = store.revisions.append({
    worktreeId,
    createdAt: 2_000,
    head: "1bc146f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    dirty: true,
    trigger: "watch",
    changes: [],
  });
  sink.markUnknown(worktreeId, number, [input.testFile], reason);
}

/**
 * The checks a timeout left unknown in the receiver, and the rows at the key.
 * Their origin and commit are left out: UNKNOWN is never stored under a key
 * (D12), so no lookup reads them.
 */
function unknownStates(store: Store, worktreeId: WorktreeId) {
  const states = store.knownStates
    .list(worktreeId)
    .map((s) => ({ check: s.check, outcome: s.outcome, validity: s.validity }));
  return { states, atKey: store.results.byKey(KEY, 3_000).map(verdictOf) };
}
