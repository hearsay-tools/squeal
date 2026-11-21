import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type RunUse, runLines } from "../../src/cli/status-at-report-run.js";
import {
  askTakeBack,
  BUDGET_ENDED,
  giveBack,
  NOT_SUPPORTED,
} from "../../src/cli/status-at-run-give-back.js";
import type { DaemonPorts, NowRunEnd } from "../../src/cli/status-at-run-now.js";
import { type DeskEvents, prepareFrontDesk } from "../../src/core/daemon/desk.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TakeBackResult } from "../../src/core/types/scheduler.js";

/*
 * Row 023-34 (T1, lessons round 5; spec 023 D4.11): at the call's end,
 * `--run` takes back from the worktree's daemon what its narrow runs
 * queued and did not start, after they had the rest of the budget, and
 * the report says so. An older daemon keeps today's line. In round 5,
 * about 1,330 files went on in the daemon after a 300 s call.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const FILE = { project: "", path: "test/a.test.ts" };
const RESULT: TakeBackResult = { takenBack: 1331, running: 7, kept: 2 };

const ended = (problem: string | null = BUDGET_ENDED): NowRunEnd => ({
  how: "daemon",
  gateMs: 300_000,
  states: new Map(),
  problem,
  leftEstimate: null,
  asked: { files: [FILE], coveredIds: ["c1", "c2"] },
});

function ports(takeBack: DaemonPorts["takeBack"], waited: string | null = BUDGET_ENDED) {
  const calls = { waits: 0, takeBacks: [] as (readonly string[])[] };
  const fake: DaemonPorts = {
    ask: async () => null,
    wait: async () => {
      calls.waits++;
      return waited;
    },
    ...(takeBack === undefined
      ? {}
      : {
          takeBack: (ids, deadline) => {
            calls.takeBacks.push(ids);
            return takeBack(ids, deadline);
          },
        }),
  };
  return { fake, calls };
}

describe("giveBack (T1)", () => {
  it("waits out the budget, takes back, and drops the 'go on in the daemon' problem", async () => {
    const { fake, calls } = ports(async () => RESULT);
    const end = await giveBack(ended(), performance.now() + 1_000, fake);
    expect(calls).toEqual({ waits: 1, takeBacks: [["c1", "c2"]] });
    expect(end).toMatchObject({ problem: null, takenBack: RESULT });
  });

  it("keeps other problems, and does not wait once the budget ended", async () => {
    const { fake, calls } = ports(async () => RESULT);
    const end = await giveBack(
      ended(`group browser: no Chrome; ${BUDGET_ENDED}`),
      performance.now() - 1,
      fake,
    );
    expect(calls.waits).toBe(0);
    expect(end).toMatchObject({ problem: "group browser: no Chrome", takenBack: RESULT });
  });

  it("takes nothing back when every file ended inside the budget", async () => {
    const { fake, calls } = ports(async () => RESULT, null);
    const end = await giveBack(ended(null), performance.now() + 1_000, fake);
    expect(calls.takeBacks).toEqual([]);
    expect(end.takenBack).toBeUndefined();
  });

  it("an older daemon keeps today's line; another failure is named", async () => {
    const old = ports(async () => NOT_SUPPORTED);
    expect(await giveBack(ended(), performance.now() - 1, old.fake)).toEqual(ended());
    const failed = ports(async () => "the daemon did not answer within 2 s");
    expect((await giveBack(ended(), performance.now() - 1, failed.fake)).problem).toBe(
      `${BUDGET_ENDED}; their take-back failed: the daemon did not answer within 2 s`,
    );
  });
});

describe("the report's take-back lines (T1)", () => {
  it("says how many were taken back, still run and stay queued", () => {
    const run = {
      timeoutSeconds: 300,
      usedMs: 300_000,
      gateMs: 1,
      selected: 0,
      ran: 0,
      stored: 0,
      notStored: [],
      changed: null,
      changedBy: null,
      notRun: 0,
      notComparable: 0,
      timedOut: false,
      estimate: null,
      rerun: null,
      now: {
        how: "daemon",
        selected: 1340,
        ran: 0,
        notRun: 0,
        gateMs: 1,
        setupFailed: [],
        problem: null,
        takenBack: RESULT,
      },
    } satisfies RunUse;
    const lines = runLines(run, "d8abcfe46");
    expect(lines).toContain("now: 1331 not run; taken back from the daemon");
    expect(lines).toContain("now: 7 still running in the daemon; their results come later");
    expect(lines).toContain(
      "now: 2 stay queued in the daemon: an edit, a forced run or another wait asked for them",
    );
    expect(lines.join("\n")).not.toContain("go on in the daemon");
  });
});

describe("askTakeBack through a daemon's socket (T1)", () => {
  async function socketWith(events: Partial<DeskEvents>): Promise<AbsolutePath> {
    const dir = mkdtempSync("/tmp/sq-give-back-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const prepared = prepareFrontDesk({
      script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
      execArgv: [
        "--disable-warning=ExperimentalWarning",
        "--import",
        fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
      ],
    });
    const desk = await prepared.open(
      {
        socketPath,
        worktreeId: "0123456789abcdef" as never,
        root: "/",
        squealVersion: "0.0.0-test",
        startedAt: 1 as never,
        token: "t",
      },
      {
        onActivity: () => {},
        requestFullSuite: () => new Promise(() => {}),
        requestSlowSuite: () => new Promise(() => {}),
        requestSync: () => new Promise(() => {}),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
        ...events,
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    return socketPath;
  }

  it("gets the scheduler's answer once it took the ids", async () => {
    let take: (result: TakeBackResult) => void = () => {};
    const socket = await socketWith({
      requestTakeBack: () =>
        new Promise((resolve) => {
          take = resolve;
        }),
    });
    const asked = askTakeBack(socket, ["c1"], Date.now() + 10_000);
    setTimeout(() => take(RESULT), 300);
    expect(await asked).toEqual(RESULT);
  });

  it("reads a daemon without take-back as not supported", async () => {
    const socket = await socketWith({});
    expect(await askTakeBack(socket, ["c1"], Date.now() + 10_000)).toBe(NOT_SUPPORTED);
  });
});
