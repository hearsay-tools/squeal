import { describe, expect, it } from "vitest";
import { readPolicy } from "../../../src/core/daemon/policy.js";
import { endTurn } from "../../../src/core/delivery/turn.js";
import { releaseLintGroup } from "../../../src/core/lint/pass/commit-entry.js";
import type { SquealRepo } from "../../harness/helpers.js";
import {
  HARNESSES,
  type Harness,
  mainConsumer,
  markStopWait,
} from "../../harness/stop-slow-helpers.js";
import { hookedRepo } from "./rig.js";

/*
 * Review 0.1.406 B2 (spec 019 D1, D4 step 3; 017 D8): a lint group at
 * `stop` whose lint finished before Stop, under `lint.blocking`. Its
 * failure is one decision with one budget, `stop.maxHolds`, across the 2 s
 * entry and the waiting entry: exactly that many holds, the finding told
 * once, then silence. Claude Code and Codex; with the waiting entry known,
 * and without it (the 2 s entry decides alone).
 */

const AT_STOP = { name: "lint", lint: true, at: "stop" };
const FAIL_LINE = "FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)";
const BLOCKING =
  "Squeal policy lint.blocking is on and 1 file went to fail lint since this session started: src/a.js (1 finding).";

/** How the lint finished before Stop: `squeal run lint`, or the agent's pause between turns. */
type Finished = "run" | "pause";

/**
 * A session in a turn whose edit to `src/a.js` the lint group at `stop`
 * linted to a failure before its Stop; `known`: the waiting entry ran for
 * the session before.
 */
async function finishedBeforeStop(
  harness: Harness,
  finished: Finished,
  maxHolds: number,
  known: boolean,
): Promise<SquealRepo> {
  const policy = { checks: [AT_STOP], stop: { slowWaitMs: 5_000, maxHolds } };
  const lint = { enabled: true, blocking: true };
  const hooked = await hookedRepo({ "src/a.js": "ok\n" }, lint, policy);
  const { r, tree } = hooked;
  await harness.startTurn(r);
  if (known) markStopWait(r, harness.name);
  await hooked.edit({ "src/a.js": "bad no-undef\n" });
  if (finished === "run") {
    const blobOf = (path: string) => tree.source.file(path)?.hash ?? null;
    releaseLintGroup(r.repo.commonDir, readPolicy(r.root), r.worktreeId, "lint", blobOf);
    await hooked.settle();
  } else {
    // The turn ends with no Stop, as an interrupt ends it; the pass lints at the pause.
    const states = r.store.knownStates.list(r.worktreeId);
    r.store.transaction(() => endTurn(r.store, mainConsumer(r), states, []));
    await hooked.settle();
    await harness.startTurn(r);
  }
  return r;
}

/**
 * Stops one after another, each after Squeal's continuation, until both
 * entries are silent: what each continuing entry printed. `known` false
 * runs the 2 s entry alone. The waiting entry runs only after a silent 2 s
 * entry: beside one that spoke it gets no hand-off and says nothing.
 */
async function stopsUntilSilent(harness: Harness, r: SquealRepo, known: boolean) {
  const said: string[] = [];
  for (let stop = 0; stop < 5; stop++) {
    const overrides = stop === 0 ? {} : { stop_hook_active: true };
    const quick = (await harness.stop(r, overrides)).stdout.trim();
    const waiting =
      known && quick === "" ? (await harness.stopSlow(r, overrides)).stdout.trim() : "";
    const spoke = [quick, waiting].filter((out) => out !== "");
    if (spoke.length === 0) return said;
    said.push(...spoke);
  }
  throw new Error(`Stop never fell silent: ${said.length} continuations`);
}

describe.each(HARNESSES)("lint finished before Stop, $name (review 0.1.406 B2)", (harness) => {
  const cases = [
    { finished: "run", maxHolds: 1, known: true },
    { finished: "run", maxHolds: 2, known: true },
    { finished: "pause", maxHolds: 1, known: true },
    { finished: "pause", maxHolds: 2, known: true },
    { finished: "run", maxHolds: 1, known: false },
    { finished: "run", maxHolds: 2, known: false },
  ] as const;
  it.each(cases)(
    "after $finished, stop.maxHolds $maxHolds, waiting entry known $known: that many holds",
    async ({ finished, maxHolds, known }) => {
      const r = await finishedBeforeStop(harness, finished, maxHolds, known);
      const said = await stopsUntilSilent(harness, r, known);
      expect(said, "one hold per allowed hold, then silence").toHaveLength(maxHolds);
      expect(said.every((out) => out.includes(BLOCKING))).toBe(true);
      expect(said.filter((out) => out.includes(FAIL_LINE)), "the finding told once").toHaveLength(
        1,
      );
    },
  );
});
