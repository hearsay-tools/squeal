import { join } from "node:path";
import { loadPolicy } from "../../../../src/core/daemon/policy.js";
import { testFileId } from "../../../../src/core/keys/index.js";
import type { SchedulerContext } from "../../../../src/core/scheduler/context.js";
import type { FileState } from "../../../../src/core/scheduler/files.js";
import { Ledger } from "../../../../src/core/scheduler/ledger.js";
import { recordTier, type Tier } from "../../../../src/core/scheduler/tiers.js";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import type {
  CheckKey,
  ResultRecord,
  TestFileRef,
  WorktreeId,
} from "../../../../src/core/types/index.js";
import type { CaseOutput, StoreInput } from "../case.js";
import { scratchStore, writeTree } from "./shared.js";
import { keysOf, observationsOf, recorded, refOf } from "./store-input.js";

/*
 * The `store` kind at a tree whose per-file decision still lives in
 * `recordTier` (task 011-37 section 5): the tier recorded by the tree's own
 * `recordTier` over a seeded ledger, each file's decision read from what the
 * recording called. Calls are read only at the top level, before the first
 * `settle`: `recordTier`'s loop over the files, not its tail. The last
 * top-level `markUnknown` is the tail's, of the files the run left unknown.
 */

type Call = { readonly method: string; readonly args: readonly unknown[] };

const TRACED = [
  "setRunning",
  "discard",
  "enqueue",
  "markUnknown",
  "rerunFirstSeen",
  "settle",
  "applyResults",
];

/** What recording `input`'s tier decided for each file, named as `store.ts` names `storeDecision`'s. */
export function storeCase(input: StoreInput, scratch: string): CaseOutput {
  const store = scratchStore(join(scratch, "store"));
  try {
    const root = writeTree(join(scratch, "worktree"), { "squeal.config.json": "{}" });
    const context = {
      store,
      worktreeId: "A" as WorktreeId,
      root,
      now: () => 2_000,
      policy: loadPolicy(root).policy,
      describe: describeFailure,
      note: () => {},
      rerunCap: 0,
      keys: {
        addObserved: (ref: TestFileRef) => {
          added.add(testFileId(ref));
          return [];
        },
        endRun: () => {},
        // Spec 016 D3: the runner Ledger#write records for each project; no output reads it.
        runnerOf: () => "vitest",
        declaredFor: () => [],
        cache: { hashOf: () => undefined },
        index: {
          key: (ref: TestFileRef) =>
            keysOf(input.files.find((f) => f.path === ref.path) ?? { path: ref.path }).grown,
          keysReadAsOne: () => null,
          reverse: { referencing: () => [] },
          closure: () => undefined,
        },
      },
    } as unknown as SchedulerContext;
    const ledger = new Ledger(context);
    const added = new Set<string>();
    const files = input.files.map((f) => {
      const keys = keysOf(f);
      const file = ledger.addFile(refOf(f.path));
      Object.assign(file, { key: keys.key, runningKey: keys.running, resultKey: keys.result });
      // A file the ledger no longer holds as it was selected: another state stands for its id.
      if (f.held === false) ledger.files.set(file.id, { ...file });
      return { f, file, keys };
    });
    const tier: Tier = {
      runId: "validity-run",
      logDir: join(scratch, "logs"),
      lane: "",
      run: 1,
      changes: new Set(),
      revision: { number: 1, head: null, dirty: false },
      checkpointId: null,
      files: files.map(({ f, file, keys }) => ({
        file,
        key: keys.ran,
        inputs: f.inputs ?? [],
        checkpointId: null,
        forced: f.forced === true,
      })),
      snapshot: undefined as unknown as Tier["snapshot"],
      cancel: input.cancelled === true ? aborted() : null,
    };
    const calls: Call[] = [];
    let depth = 0;
    for (const method of TRACED) {
      const own = (ledger as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
      if (own === undefined) continue;
      Object.assign(ledger, {
        [method]: (...args: unknown[]) => {
          if (depth === 0) calls.push({ method, args });
          depth++;
          try {
            return own.apply(ledger, args);
          } finally {
            depth--;
          }
        },
      });
    }
    const stored = new Map<string, CheckKey>();
    const putMany = store.results.putMany.bind(store.results);
    store.results.putMany = (records: readonly ResultRecord[]) => {
      if (calls.every((c) => c.method !== "settle")) {
        for (const r of records) stored.set(testFileId(refOf(r.check.testPath)), r.key);
      }
      return putMany(records);
    };
    const { report, requeue } = recorded(input);
    const discards = new Map(files.map(({ file }) => [file.id, file.discards]));
    recordTier(
      context,
      ledger,
      tier,
      report,
      new Set(input.changed ?? []),
      requeue,
      observationsOf(input),
      false,
    );
    const end = calls.findIndex((c) => c.method === "settle");
    const loop = end < 0 ? calls : calls.slice(0, end);
    const tail = end < 0 ? [] : calls.slice(end);
    const of = (list: readonly Call[], method: string, file: FileState) =>
      list.filter((c) => c.method === method && c.args[0] === file);
    const unknown = tail.filter((c) => c.method === "markUnknown").at(-1);
    const decisions = files.map(({ f, file }) => {
      const discard = of(loop, "discard", file)[0];
      const named = (call: Call | undefined, at: number) =>
        ((call?.args[at] ?? []) as readonly { file: FileState }[]).some((e) => e.file === file);
      const decision =
        of(loop, "setRunning", file).length === 0
          ? "superseded"
          : discard !== undefined
            ? (discard.args[3] as string[]).length === 0
              ? "withheld"
              : `unstable: ${(discard.args[3] as string[]).join(", ")}`
            : file.tierCap !== null
              ? `split at ${file.tierCap}`
              : of(loop, "enqueue", file).length > 0
                ? "requeue"
                : stored.has(file.id)
                  ? `store at ${stored.get(file.id)}`
                  : named(
                        tail.find((c) => c.method === "rerunFirstSeen"),
                        0,
                      )
                    ? "first seen"
                    : named(unknown, 0)
                      ? "unknown"
                      : file.blocked !== null
                        ? "not started"
                        : file.discards > (discards.get(file.id) ?? 0)
                          ? "environment"
                          : "nothing";
      const current = of(loop, "applyResults", file).length > 0;
      return { path: f.path, decision, grown: added.has(file.id), current };
    });
    return { outputs: { decisions }, wording: { failure: report.failure } };
  } finally {
    store.close();
  }
}

function aborted(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}
