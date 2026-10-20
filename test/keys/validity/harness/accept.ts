import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import type { SchedulerContext } from "../../../../src/core/scheduler/context.js";
import { recordsForFile } from "../../../../src/core/scheduler/records.js";
import { stateFromResult } from "../../../../src/core/state/derive.js";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import { createStateSink } from "../../../../src/core/state/sink.js";
import type { TestFileKeyRecord, WorktreeId } from "../../../../src/core/types/index.js";
import type { AcceptInput, CaseOutput } from "../case.js";
import { acceptRule } from "./accept-rule.js";
import { KEY, provenance, REPORT, scratchStore, verdictOf, writeTree } from "./shared.js";

/*
 * The upgrade itself (011 C3; task 011-37 D1 a): each tree stores the same
 * runs under one key, as each run's own worktree does, with its own store
 * code. The candidate then decides over the store each tree wrote, as a
 * user's daemon opens a store an earlier release wrote, and the two
 * decisions are compared.
 */

/** Stores `input.runs` in a store under `scratch`, each applied to its own worktree's states. */
export function writeAccept(input: AcceptInput, scratch: string): CaseOutput {
  const store = scratchStore(join(scratch, "store"));
  try {
    const sink = createStateSink(store, { now: () => 2_000 });
    for (const [at, run] of input.runs.entries()) {
      const records = recordsForFile({
        ref: input.testFile,
        key: KEY,
        report: { ...REPORT, completedFiles: [input.testFile], ...run.report },
        previousChecks: run.previousChecks ?? [],
        provenance: provenance(run.worktree, run.recordedAt, `run-${at}`),
        describe: describeFailure,
      });
      store.results.putMany(records);
      sink.applyResults(run.worktree as WorktreeId, 1, records, { checkpointId: null });
    }
    return {};
  } finally {
    store.close();
  }
}

/**
 * The receiver's lookup of the key over the store under `stored`: accepted
 * or held, the states its rows give, and the checks they retire.
 */
export function decideAccept(input: AcceptInput, stored: string, scratch: string): CaseOutput {
  const store = scratchStore(join(stored, "store"));
  try {
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
        // From format 18 a miss reads the formats read as one first (011-38); none here.
        index: { keysReadAsOne: () => null },
      },
    } as unknown as SchedulerContext;
    const probe = acceptRule(context, input.testFile, KEY, input.current ?? []);
    const key: TestFileKeyRecord = {
      worktreeId,
      testFile: input.testFile,
      key: KEY,
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
      },
    };
  } finally {
    store.close();
  }
}
