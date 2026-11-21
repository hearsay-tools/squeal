import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { Gate } from "./batch-fixture.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { groupPolicy, inTurn, runnerLane } from "./group-lanes-fixture.js";

/*
 * Row 023-34 (T1, review wave-20 B1-B3): a started scheduler over `files`
 * with the default baseline (lookup-only, as a user's daemon has it: a
 * miss is not queued until asked), one file a tier, and a gate that holds
 * every run until the test lets it go.
 */

/** A manual group of `test/browser/**`: its files run only when asked. */
export const BROWSER: CheckGroup = {
  name: "browser",
  runner: "vitest",
  tests: ["test/browser/**"],
  at: "manual",
};

export async function heldSide(
  files: readonly CatchUpFile[],
  options: { readonly checks?: readonly CheckGroup[]; readonly hostSlots?: number } = {},
): Promise<{ side: CatchUpSide; gate: Gate }> {
  const repo = catchUpRepo(files);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-023-34-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: options.hostSlots ?? 8,
    tierSize: 1,
    lane: runnerLane,
    policy: {
      ...groupPolicy({ checks: [...(options.checks ?? [BROWSER])] }),
      baseline: { onStart: "lookup-only" },
    },
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
  });
  const turn = await inTurn(side);
  const gate = new Gate();
  onTestFinished(async () => {
    gate.stop();
    await turn.end();
  });
  await side.scheduler.start();
  await side.rest();
  side.runner.holdOf = () => gate.wait();
  return { side, gate };
}
