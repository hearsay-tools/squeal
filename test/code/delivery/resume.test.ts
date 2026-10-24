import { beforeEach, describe, expect, it } from "vitest";
import { readCodeReport } from "../../../src/cli/code-report.js";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import { codeStatusOf } from "../../../src/core/status/code-status.js";
import type { Consumer, RevisionTrigger, Store } from "../../../src/core/types/index.js";
import type { HookContext } from "../../../src/harness/shared/context.js";
import { codeStopReason } from "../../../src/harness/shared/stop-code.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, setKey, WT } from "../../state/helpers.js";
import { policyOn } from "../pass/helpers.js";
import {
  type CodeRepo,
  codeRepo,
  codeState,
  codeTransition,
  fn,
  fnCheck,
  putFile,
} from "./helpers.js";

/*
 * Review 0.1.290 B1: a session resumed from its parked registration
 * before its new daemon's start scan was told that scan's change as its
 * FAIL, and status, Stop and `squeal code --changed` counted it. The start
 * scan after a resume is not the session's, as after a fresh registration
 * (015-20); the session's own changes from before the pause still are.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const OWN = fnCheck("own", "src/own.ts");
const OFFLINE = fnCheck("offline", "src/offline.ts");
const LATER = fnCheck("later", "src/later.ts");
const CHECKS = [OWN, OFFLINE, LATER];
const COMPLEXITY = policyOn({ blocking: true }).complexity;

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
  clock += 1_000;
  return main.revisions.append({
    worktreeId: WT,
    createdAt: clock,
    head: null,
    dirty: true,
    trigger,
    changes: [{ path, oldHash: null, newHash: `${path}@${clock}` }],
  }).number;
}

/** Every function counted at 18, then the session registers with no daemon. */
async function registered(): Promise<void> {
  for (const check of CHECKS) {
    putFile(repo.store, WT, check.path, [fn(check.qualifiedName, 18, 1)]);
  }
  repo.store.states.upsertMany(CHECKS.map((check) => codeState(WT, check, 18)));
  await delivery().register(C1);
}

/** The pass over `revision`: `check` from 18 to 23, recorded `pass-to-fail`. */
function wentOver(check: typeof OWN, revision: number): void {
  clock += 1_000;
  putFile(repo.store, WT, check.path, [fn(check.qualifiedName, 23, 1)], { revision });
  repo.store.states.upsertMany([codeState(WT, check, 23, { revision })]);
  repo.store.transitions.append([
    codeTransition(WT, check, "pass-to-fail", { from: 18, to: 23, at: clock, revision }),
  ]);
}

/** The code lines told to C1 at its next tool boundary. */
async function told(): Promise<string[]> {
  clock += 1_000;
  const delta = await delivery().onToolBoundary(C1);
  if (delta === null) return [];
  return formatDelta(delta)
    .split("\n")
    .filter((line) => line.includes(" complexity: "));
}

/** The session ends, its registration parked, and comes back before a daemon scans. */
async function resumed(): Promise<void> {
  clock += 1_000;
  await delivery().unregister(C1);
  clock += 1_000;
  await delivery().register(C1);
}

/** What status, blocking Stop and `squeal code --changed` count since the session started. */
function since() {
  const shell = { session: C1.sessionId, agent: null };
  const context = { store: main, consumer: C1, code: repo.source, root: repo.root };
  const report = readCodeReport(main, repo.store, WT, COMPLEXITY, {
    paths: null,
    changed: true,
    shell,
  });
  const status = codeStatusOf(main, WT, { root: repo.root, commonDir: () => repo.dir }, shell);
  return {
    status: status.code?.sinceRegistration,
    stop: codeStopReason(context as unknown as HookContext, COMPLEXITY),
    changed: report.functions.map((f) => f.qualifiedName),
  };
}

const FAIL = (name: string) =>
  `FAIL complexity: ${name} (src/${name}.ts:1) is 23, over 20 (ESLint rule)`;
const STOP = (names: string) =>
  `Squeal policy complexity.blocking is on and 1 function went over the complexity threshold 20 since this session started: ${names}. \`squeal code --changed\` lists them.`;

describe("a session resumed before its new daemon's start scan (review 0.1.290 B1)", () => {
  it("takes the start scan in by count, keeps its own change from before the pause, and tells a later edit", async () => {
    await registered();
    // The first daemon's start scan, then the session's own edit, told.
    revise("start", "src/other.ts");
    wentOver(OWN, revise("watch", OWN.path));
    expect(await told()).toEqual([FAIL("own")]);
    await resumed();

    // What changed while no daemon ran, as the new daemon's start scan stores it.
    wentOver(OFFLINE, revise("start", OFFLINE.path));
    expect(await told()).toEqual([]);
    expect(repo.store.views.list(C1).map((v) => [v.check.qualifiedName, v.told])).toEqual(
      expect.arrayContaining([["offline", "count"]]),
    );
    expect(since()).toEqual({ status: 1, stop: STOP("own (src/own.ts:1)"), changed: ["own"] });

    // The session's next edit is its own.
    wentOver(LATER, revise("watch", LATER.path));
    expect(await told()).toEqual([FAIL("later")]);
    expect(since().changed).toEqual(["later", "own"]);
    expect(since().stop).not.toContain("offline");
  });

  it("still tells its own change from before the pause that the pass counts after it comes back", async () => {
    await registered();
    revise("start", "src/other.ts");
    const own = revise("watch", OWN.path);
    await resumed();
    wentOver(OFFLINE, revise("start", OFFLINE.path));
    // The pass reaches the session's edit only now.
    wentOver(OWN, own);
    expect(await told()).toEqual([FAIL("own")]);
    expect(since().changed).toEqual(["own"]);
  });

  it("takes in by count what changed while it was away and a daemon ran", async () => {
    await registered();
    revise("start", "src/other.ts");
    wentOver(OWN, revise("watch", OWN.path));
    expect(await told()).toEqual([FAIL("own")]);
    clock += 1_000;
    await delivery().unregister(C1);
    // Another session's edit while this one is away, counted after it comes back.
    const away = revise("watch", OFFLINE.path);
    clock += 1_000;
    await delivery().register(C1);
    wentOver(OFFLINE, away);
    expect(await told()).toEqual([]);
    expect(since().changed).toEqual(["own"]);
  });

  it("tells no STILL FAIL for the start scan's edit, and one for the session's next", async () => {
    await registered();
    revise("start", "src/other.ts");
    wentOver(OWN, revise("watch", OWN.path));
    expect(await told()).toEqual([FAIL("own")]);
    await resumed();
    const edited = (revision: number, cc: number) => {
      clock += 1_000;
      repo.store.states.upsertMany([codeState(WT, OWN, cc, { revision })]);
      repo.store.states.markEdited(WT, [
        { check: OWN, measure: "complexity", revision, at: clock },
      ]);
    };
    edited(revise("start", OWN.path), 24);
    expect(await told()).toEqual([]);
    edited(revise("watch", OWN.path), 25);
    expect((await told()).join("\n")).toContain("STILL FAIL complexity: own (src/own.ts:1) is 25");
  });

  it("takes in each start scan after two pauses, and keeps the edit between them", async () => {
    await registered();
    revise("start", "src/other.ts");
    await resumed();
    wentOver(OWN, revise("watch", OWN.path));
    expect(await told()).toEqual([FAIL("own")]);
    await resumed();
    wentOver(OFFLINE, revise("start", OFFLINE.path));
    expect(await told()).toEqual([]);
    expect(since()).toEqual({ status: 1, stop: STOP("own (src/own.ts:1)"), changed: ["own"] });
  });

  it("tells a revision after the resume that is not a start scan's", async () => {
    await registered();
    revise("start", "src/other.ts");
    await resumed();
    wentOver(LATER, revise("watch", LATER.path));
    expect(await told()).toEqual([FAIL("later")]);
    expect(since().changed).toEqual(["later"]);
  });
});

describe("a fresh session before its daemon's start scan (015-20, the same rule)", () => {
  it("takes the start scan in by count in delivery, status, Stop and --changed", async () => {
    await registered();
    wentOver(OFFLINE, revise("start", OFFLINE.path));
    expect(await told()).toEqual([]);
    expect(since()).toEqual({ status: 0, stop: null, changed: [] });
    wentOver(OWN, revise("watch", OWN.path));
    expect(await told()).toEqual([FAIL("own")]);
    expect(since()).toEqual({ status: 1, stop: STOP("own (src/own.ts:1)"), changed: ["own"] });
  });
});
