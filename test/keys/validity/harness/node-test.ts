import { copyFileSync, mkdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { CoverageRun } from "../../../../src/core/code/coverage/types.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import type { TestFileRef } from "../../../../src/core/types/keys.js";
import { createNodeTestAdapter } from "../../../../src/runners/node-test/adapter.js";
import type { CaseOutput, NodeTestInput } from "../case.js";
import { type Decided, decided, Kept, storedRun } from "./reported.js";
import { goneLogDir, tell, traitsAsked, writeTree } from "./shared.js";

/*
 * The `adapter:node-test` kind (011 C14, spec 003 D1 to D6, row 016-17): the
 * tree's node:test adapter over a fixture worktree, on the driver's own
 * Node, with the runtime its side copied beside the driver
 * (`dist/node-test/`). As the pytest kind reads it: what the adapter
 * decides before a stored row is keys (each environment, the listed test
 * files, each file's closure and static checks); what a run reports is
 * outputs, as the scheduler stores it (`reported.ts`), a completed file
 * whose run loaded a start-up path its key lacked withheld. The run's
 * failure and notes are wording.
 *
 * Rows 004-37 and 019-12: with `concurrency`, a run in the adapter's own
 * lane starts that many files at once and one in a group lane every file
 * (`RunOptions.lane`): how many run together, never what a run stores.
 *
 * Row 015-86: with `coverage`, the adapter gets Squeal's coverage, which a
 * release before it ignores. The marker a coverage-on key holds is
 * wording, so the keys compare as with coverage off and the runs must
 * store alike; each payload the candidate hands over is a record it
 * stores, `<file> (coverage record)` among the run's completed files. The
 * payloads go to the driver's own `NODE_V8_COVERAGE`, where the recorder's
 * lines in a covered test file's process count (`sides.ts`). What
 * `invalidate` answers after the runs is a key.
 *
 * Rows 020-43 and 020-44: with `gate`, the adapter takes the gate's slot
 * pool and file-start hook, which a release before them ignores. They
 * bound how many processes run at once and tell each file's start and
 * end, never what a run stores; what the hook was told is wording.
 */

const PROJECT = "validity";

/** Runs `input`'s runs in turn on one adapter over its fixture, under `scratch`. */
export async function nodeTestCase(input: NodeTestInput, scratch: string): Promise<CaseOutput> {
  const root = realpathSync(writeTree(join(scratch, "worktree"), input.files)) as AbsolutePath;
  const tempDir = join(scratch, "tmp") as AbsolutePath;
  mkdirSync(tempDir, { recursive: true });
  const notes: string[] = [];
  const recorded: string[] = [];
  const { concurrency, gate } = input;
  const told: string[] = [];
  const adapter = await createNodeTestAdapter(
    {
      name: PROJECT,
      node: process.execPath,
      argv: [...(input.argv ?? [])],
      env: { ...input.env },
      include: input.include ?? ["test/*.test.mjs"],
    },
    {
      root,
      note: (text) => notes.push(text),
      tempDir,
      ...(concurrency === undefined ? {} : { concurrency: () => concurrency }),
      ...(gate === undefined
        ? {}
        : { slots: slotPool(gate.slots), fileStarted: (ref: TestFileRef) => tell(told, ref) }),
      ...(input.coverage === undefined
        ? {}
        : {
            coverage: {
              enabled: () => input.coverage === true,
              collected: (run: CoverageRun) => recorded.push(...handedOver(run)),
            },
          }),
    },
  );
  const ref = (path: string): TestFileRef => ({ project: PROJECT, path });
  const core = new Kept();
  const steps: Decided[] = [];
  const runs: ReturnType<typeof storedRun>[] = [];
  const loaded: unknown[] = [];
  const failures: (string | null)[] = [];
  const markers: unknown[] = [];
  const invalidated: unknown[] = [];
  const step = async () => {
    const at = unmarked(await decided(adapter, [], core));
    steps.push(at.step);
    markers.push(at.markers);
  };
  try {
    await step();
    for (const [at, run] of input.runs.entries()) {
      const report = await adapter.run(run.files.map(ref), {
        runId: `validity-${at}`,
        logDir:
          run.storeGone === true ? goneLogDir(scratch, at) : join(scratch, "logs", String(at)),
        timeoutMs: run.timeoutMs ?? 60_000,
        ...(run.lane === undefined ? {} : { lane: run.lane }),
        ...(run.storeGone === true ? { stop: AbortSignal.abort() } : {}),
      });
      const stored = storedRun(report, steps[steps.length - 1] as Decided);
      runs.push({ ...stored, completed: [...stored.completed, ...recorded.splice(0)].sort() });
      core.add(report);
      loaded.push(report.environmentObserved ?? []);
      failures.push(report.failure);
      traitsAsked(adapter, run.files.map(ref));
      await step();
    }
    if (input.coverage !== undefined) invalidated.push(await adapter.invalidate([]));
  } finally {
    await adapter.close();
  }
  return {
    keys: { steps, loaded, ...(input.coverage === undefined ? {} : { invalidated }) },
    outputs: { runs },
    wording: {
      failures,
      notes: notes.map((n) => n.replaceAll(root, "<root>")),
      ...(input.coverage === undefined ? {} : { markers }),
      ...(gate === undefined ? {} : { told }),
    },
  };
}

/**
 * A pool of `size` slots, as the gate's `SlotPool` (row 020-44) gives them:
 * at once while one is free, else in the order asked, and `null` once the
 * signal aborted. The harness holds its own: a release has no `SlotPool`
 * to bundle.
 */
function slotPool(size: number): (signal: AbortSignal) => Promise<(() => void) | null> {
  let free = size;
  const waiting: ((release: () => void) => void)[] = [];
  const release = (): (() => void) => {
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const next = waiting.shift();
      if (next === undefined) free += 1;
      else next(release());
    };
  };
  return (signal) => {
    if (signal.aborted) return Promise.resolve(null);
    if (free > 0) {
      free -= 1;
      return Promise.resolve(release());
    }
    return new Promise((resolve) => {
      const grant = (slot: () => void) => {
        signal.removeEventListener("abort", onAbort);
        resolve(slot);
      };
      const onAbort = () => {
        waiting.splice(waiting.indexOf(grant), 1);
        resolve(null);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      waiting.push(grant);
    });
  };
}

/**
 * The files a run handed over, as stored files, each payload copied into
 * the driver's own coverage directory.
 */
function handedOver(run: CoverageRun): string[] {
  const own = process.env.NODE_V8_COVERAGE;
  if (own !== undefined) mkdirSync(own, { recursive: true });
  return run.files.map((file) => {
    if (own !== undefined) copyFileSync(file.payload, join(own, basename(file.payload)));
    return `${file.testFile.project}:${file.testFile.path} (coverage record)`;
  });
}

/** A step with each environment's coverage marker taken out of its config, and the markers. */
function unmarked(step: Decided): { step: Decided; markers: unknown[] } {
  const markers: unknown[] = [];
  const environments = step.environments.map((environment) => {
    const { coverage, ...config } = JSON.parse(environment.resolvedConfig) as {
      coverage?: unknown;
    };
    markers.push(coverage ?? null);
    return { ...environment, resolvedConfig: JSON.stringify(config) };
  });
  return { step: { ...step, environments }, markers };
}
