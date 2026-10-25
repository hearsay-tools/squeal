import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath, TestFileRef } from "../../../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../../../src/runners/node-test/adapter.js";
import type { CaseOutput, NodeTestInput } from "../case.js";
import { type Decided, decided, Kept, storedRun } from "./reported.js";
import { writeTree } from "./shared.js";

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
 */

const PROJECT = "validity";

/** Runs `input`'s runs in turn on one adapter over its fixture, under `scratch`. */
export async function nodeTestCase(input: NodeTestInput, scratch: string): Promise<CaseOutput> {
  const root = realpathSync(writeTree(join(scratch, "worktree"), input.files)) as AbsolutePath;
  const tempDir = join(scratch, "tmp") as AbsolutePath;
  mkdirSync(tempDir, { recursive: true });
  const notes: string[] = [];
  const adapter = await createNodeTestAdapter(
    {
      name: PROJECT,
      node: process.execPath,
      argv: [],
      env: {},
      include: input.include ?? ["test/*.test.mjs"],
    },
    { root, note: (text) => notes.push(text), tempDir },
  );
  const ref = (path: string): TestFileRef => ({ project: PROJECT, path });
  const core = new Kept();
  const steps: Decided[] = [];
  const runs: ReturnType<typeof storedRun>[] = [];
  const loaded: unknown[] = [];
  const failures: (string | null)[] = [];
  try {
    steps.push(await decided(adapter, [], core));
    for (const [at, run] of input.runs.entries()) {
      const report = await adapter.run(run.files.map(ref), {
        runId: `validity-${at}`,
        logDir: join(scratch, "logs", String(at)),
        timeoutMs: 60_000,
      });
      runs.push(storedRun(report, steps[steps.length - 1] as Decided));
      core.add(report);
      loaded.push(report.environmentObserved ?? []);
      failures.push(report.failure);
      steps.push(await decided(adapter, [], core));
    }
  } finally {
    await adapter.close();
  }
  return {
    keys: { steps, loaded },
    outputs: { runs },
    wording: { failures, notes: notes.map((n) => n.replaceAll(root, "<root>")) },
  };
}
