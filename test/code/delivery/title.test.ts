import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import type { CodeCheckId } from "../../../src/core/types/code.js";
import type { Consumer, Store } from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { check, freshStore, result, setKey, WT } from "../../state/helpers.js";
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
 * Lessons round 1, delivery titles: STILL FAIL lines alone were titled
 * `3 complexity changes` though nothing changed state, and a delivery with
 * test failures was titled by the tests alone, leaving its code line out.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const PLAN = fnCheck("planTier");
const RANK = fnCheck("rankTier");
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

/** `planTier` and `rankTier` over 20 at registration, `selectTier` under. */
async function registered(): Promise<void> {
  putFile(repo.store, WT, TIERS, [
    fn("planTier", 30, 40),
    fn("rankTier", 25, 80),
    fn("selectTier", 18, 120),
  ]);
  repo.store.states.upsertMany([
    codeState(WT, PLAN, 30),
    codeState(WT, RANK, 25),
    codeState(WT, SELECT, 18),
  ]);
  await delivery().register(C1);
  clock += 1_000;
}

/** The pass after edits to these functions, each still over. */
function editedStillOver(...checks: CodeCheckId[]): void {
  repo.store.states.markEdited(
    WT,
    checks.map((c) => ({ check: c, measure: "complexity", revision: 2, at: clock })),
  );
}

function selectWentOver(): void {
  repo.store.states.upsertMany([codeState(WT, SELECT, 23, { revision: 2 })]);
  repo.store.transitions.append([
    codeTransition(WT, SELECT, "pass-to-fail", { from: 18, to: 23, at: clock }),
  ]);
}

async function titleOfNext(): Promise<string> {
  const delta = (await delivery().onToolBoundary(C1)) ?? expect.fail("no delta");
  return formatDelta(delta).split("\n")[0] ?? "";
}

describe("a delivery's title names its code lines (lessons round 1)", () => {
  it("counts no STILL FAIL as a change", async () => {
    await registered();
    editedStillOver(PLAN, RANK);
    expect(await titleOfNext()).toBe(
      "SQUEAL · 2 functions still over the complexity threshold at revision 0",
    );
  });

  it("names the changes and the functions still over apart", async () => {
    await registered();
    selectWentOver();
    editedStillOver(PLAN);
    expect(await titleOfNext()).toBe(
      "SQUEAL · 1 complexity change and 1 function still over the complexity threshold at revision 0",
    );
  });

  it("names the code lines after the tests' words", async () => {
    await registered();
    editedStillOver(RANK);
    createStateSink(main, { now: () => clock }).applyResults(WT, 1, [result(check("a"), "fail")], {
      checkpointId: null,
    });
    expect(await titleOfNext()).toMatch(
      /^SQUEAL · 1 check changed \(1 test\) at revision \d+; 1 function still over the complexity threshold$/,
    );
  });
});
