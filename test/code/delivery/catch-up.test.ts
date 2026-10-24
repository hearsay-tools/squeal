import { beforeEach, describe, expect, it } from "vitest";
import { codeSeenUpTo } from "../../../src/core/delivery/code-since.js";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import type { Consumer, RevisionTrigger, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, setKey, WT } from "../../state/helpers.js";
import {
  type CodeRepo,
  codeRepo,
  codeState,
  codeTransition,
  fn,
  fnCheck,
  putFile,
  TIERS,
} from "./helpers.js";

/*
 * Lessons round 1, P2 (sq2): a reset made while no daemon ran was told as
 * the next session's FAIL. Its SessionStart registered before the new
 * daemon's start scan, whose `start` revision held the reset.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const STOP = fnCheck("stopCommand", "src/cli/stop.ts");
const SELECT = fnCheck("selectTier");

let main: Store;
let repo: CodeRepo;
let clock: number;

beforeEach(() => {
  main = freshStore();
  repo = codeRepo();
  clock = 10_000;
  setKey(main, "k1");
});

const delivery = () =>
  createDelivery(main, { status: fixedStatus(), now: () => clock, code: repo.source });

function revise(trigger: RevisionTrigger, path: string): number {
  return main.revisions.append({
    worktreeId: WT,
    createdAt: clock,
    head: null,
    dirty: true,
    trigger,
    changes: [{ path, oldHash: null, newHash: `${path}@${clock}` }],
  }).number;
}

/** `stopCommand` at 20 and `selectTier` at 18, counted, then the session registers with no start scan. */
async function registered(): Promise<void> {
  putFile(repo.store, WT, STOP.path, [fn("stopCommand", 20, 45)]);
  putFile(repo.store, WT, TIERS, [fn("selectTier", 18, 120)]);
  repo.store.states.upsertMany([codeState(WT, STOP, 20), codeState(WT, SELECT, 18)]);
  await delivery().register(C1);
}

/** The pass over `revision`: `check` from `from` to `to`, recorded `pass-to-fail`. */
function wentOver(check: typeof STOP, from: number, to: number, revision: number, line: number) {
  clock += 1_000;
  putFile(repo.store, WT, check.path, [fn(check.qualifiedName, to, line)], { revision });
  repo.store.states.upsertMany([codeState(WT, check, to, { revision })]);
  repo.store.transitions.append([
    codeTransition(WT, check, "pass-to-fail", { from, to, at: clock, revision }),
  ]);
}

describe("a change made while no daemon ran (lessons round 1, P2)", () => {
  it("takes the start scan's revision in by count, and tells the session's own edits", async () => {
    await registered();
    const since = codeSeenUpTo(main, C1) ?? expect.fail("no registration");
    // The reset, as the new daemon's start scan stores it.
    const reset = revise("start", STOP.path);
    expect(codeSeenUpTo(main, C1)).toBe(reset);
    expect(reset).toBe(since + 1);
    wentOver(STOP, 20, 21, reset, 45);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
    // Taken in by count: the view holds it failing, as `squeal code` lists it.
    expect(repo.store.views.list(C1).map((v) => [v.check.qualifiedName, v.told])).toEqual([
      ["stopCommand", "count"],
    ]);

    // The session's own edit after it is told.
    const edit = revise("watch", TIERS);
    wentOver(SELECT, 18, 23, edit, 120);
    const text = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    expect(text).toContain(
      "FAIL complexity: selectTier (src/core/scheduler/tiers.ts:120) is 23, over 20",
    );
    expect(text).not.toContain("stopCommand");
  });

  it("tells a STILL FAIL on the session's first edit of a function the start scan took over", async () => {
    await registered();
    const reset = revise("start", STOP.path);
    wentOver(STOP, 20, 21, reset, 45);
    repo.store.states.markEdited(WT, [
      { check: STOP, measure: "complexity", revision: reset, at: clock },
    ]);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
    const edit = revise("watch", STOP.path);
    clock += 1_000;
    repo.store.states.upsertMany([codeState(WT, STOP, 22, { revision: edit })]);
    repo.store.states.markEdited(WT, [
      { check: STOP, measure: "complexity", revision: edit, at: clock },
    ]);
    const text = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    expect(text).toContain("STILL FAIL complexity: stopCommand (src/cli/stop.ts:45) is 22");
  });

  it("tells the first revision after the registration when it is not a start scan's", async () => {
    await registered();
    const edit = revise("watch", STOP.path);
    expect(codeSeenUpTo(main, C1)).toBe(edit - 1);
    wentOver(STOP, 20, 21, edit, 45);
    const text = formatDelta((await delivery().onToolBoundary(C1)) ?? expect.fail("no delta"));
    expect(text).toContain("FAIL complexity: stopCommand (src/cli/stop.ts:45) is 21, over 20");
  });

  it("takes in by count a change the pass had not counted when the session registered", async () => {
    // The revision is stored, but the pass has not reached it.
    const late = revise("watch", STOP.path);
    await registered();
    expect(codeSeenUpTo(main, C1)).toBe(late);
    wentOver(STOP, 20, 21, late, 45);
    expect(await delivery().onToolBoundary(C1)).toBeNull();
    expect(repo.store.views.list(C1).map((v) => v.check.qualifiedName)).toEqual(["stopCommand"]);
  });
});
