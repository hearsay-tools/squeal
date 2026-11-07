import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { type DeskEvents, prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers, type HandlerContext } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import {
  type GroupRequested,
  NARROW_NOT_SUPPORTED,
  requestGroup,
} from "../../src/core/daemon/run-group.js";
import type { AbsolutePath, RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import type { DaemonResponse } from "../../src/core/types/daemon.js";
import type { NarrowRun, Scheduler } from "../../src/core/types/scheduler.js";

/*
 * Row 019-49 (spec 019 D6, "Narrow run"): the `run-group-paths` request
 * from the socket to `Scheduler.requestGroupPaths`, answered as `run-group`
 * with the selection in `narrow`. A daemon or scheduler before it runs
 * nothing: never the whole group.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const NARROW: NarrowRun = {
  selected: [{ project: "", path: "test/e2e/a.test.ts" }],
  reached: 2,
  others: [{ group: "unit", files: 1, paths: ["src/core.ts"] }],
  unmatched: ["src/none.ts"],
  current: 0,
  notRun: [],
};
const TAKEN: GroupRequested = { revision: 7 as RevisionNumber, queued: 1, narrow: NARROW };

type Asked = { group: string; paths: readonly RelativePath[] | undefined };

function handler(requestGroup: NonNullable<HandlerContext["requestGroup"]> | null) {
  return createHandlers({
    worktreeId: "0123456789abcdef" as never,
    root: "/" as never,
    squealVersion: "0.0.0-test",
    startedAt: 1 as never,
    token: "t",
    phase: () => "ready",
    requestFullSuite: () => new Promise(() => {}),
    requestSlowSuite: () => Promise.reject(new Error("must not run the slow tier")),
    ...(requestGroup === null ? {} : { requestGroup }),
    onActivity: () => {},
    onStop: () => {},
    onStepDown: () => {},
  });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function requestId(response: DaemonResponse | null): string {
  if (response === null || !response.ok || response.type !== "run-group") {
    throw new Error(JSON.stringify(response));
  }
  return response.requestId;
}

describe("the run-group-paths request (019-49)", () => {
  it("parses a group and a non-empty list of paths", () => {
    expect(parseRequest('{"type":"run-group-paths","group":"e2e","paths":["src/a.ts"]}')).toEqual({
      type: "run-group-paths",
      group: "e2e",
      paths: ["src/a.ts"],
    });
    for (const bad of ['"paths":[]', '"paths":[""]', '"paths":"src/a.ts"', ""]) {
      expect(parseRequest(`{"type":"run-group-paths","group":"e2e"${bad ? `,${bad}` : ""}}`)).toBe(
        '"paths" must be a non-empty list of non-empty strings',
      );
    }
    expect(parseRequest('{"type":"run-group-paths","paths":["a"]}')).toBe(
      '"group" must be a non-empty string',
    );
  });

  it("hands group and paths to the main thread and answers the selection in `narrow`", async () => {
    const asked: Asked[] = [];
    const handle = handler((group, _held, paths) => {
      asked.push({ group, paths });
      return Promise.resolve(TAKEN);
    });
    const id = requestId(handle({ type: "run-group-paths", group: "e2e", paths: ["src/a.ts"] }));
    await settle();
    expect(handle({ type: "run-group-status", requestId: id })).toMatchObject({
      type: "run-group",
      group: "e2e",
      requested: { revision: 7, queued: 1 },
      narrow: NARROW,
    });
    expect(asked).toEqual([{ group: "e2e", paths: ["src/a.ts"] }]);
    // A whole group's request carries no `narrow`, as before.
    const whole = handler(() => Promise.resolve({ revision: 7 as RevisionNumber, queued: 3 }));
    const wholeId = requestId(whole({ type: "run-group", group: "e2e" }));
    await settle();
    expect(whole({ type: "run-group-status", requestId: wholeId })).not.toHaveProperty("narrow");
  });

  it("answers not supported, running nothing, when the daemon cannot run groups", async () => {
    const handle = handler(null);
    const id = requestId(handle({ type: "run-group-paths", group: "e2e", paths: ["src/a.ts"] }));
    await settle();
    expect(handle({ type: "run-group-status", requestId: id })).toMatchObject({
      requested: null,
      error: NARROW_NOT_SUPPORTED,
    });
  });
});

describe("requestGroup with paths on the daemon's scheduler (019-49)", () => {
  it("calls requestGroupPaths, never requestGroup", async () => {
    const calls: string[] = [];
    const stub = {
      requestGroup: () => {
        calls.push("whole");
        return Promise.resolve({ revision: 1 as RevisionNumber, queued: 9 });
      },
      requestGroupPaths: (group: string, paths: readonly RelativePath[]) => {
        calls.push(`${group}: ${paths.join(" ")}`);
        return Promise.resolve(TAKEN);
      },
    } as unknown as Scheduler;
    await expect(requestGroup(stub, "e2e", undefined, ["src/a.ts"])).resolves.toEqual(TAKEN);
    expect(calls).toEqual(["e2e: src/a.ts"]);
  });

  it("refuses with NARROW_NOT_SUPPORTED on a scheduler before narrow runs, running nothing", async () => {
    let whole = 0;
    const old = {
      requestGroup: () => {
        whole++;
        return Promise.resolve({ revision: 1 as RevisionNumber, queued: 9 });
      },
    } as unknown as Scheduler;
    await expect(requestGroup(old, "e2e", undefined, ["src/a.ts"])).rejects.toThrow(
      NARROW_NOT_SUPPORTED,
    );
    expect(whole).toBe(0);
  });
});

describe("run-group-paths through the front desk (019-49)", () => {
  const worker = {
    script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
    execArgv: [
      "--disable-warning=ExperimentalWarning",
      "--import",
      fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
    ],
  };

  async function open(inWorker: boolean, requestGroup: DeskEvents["requestGroup"]) {
    const dir = mkdtempSync("/tmp/sq-narrow-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const desk = await prepareFrontDesk(inWorker ? worker : null).open(
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
        ...(requestGroup === undefined ? {} : { requestGroup }),
        requestSync: () => new Promise(() => {}),
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    return socketPath;
  }

  for (const inWorker of [false, true]) {
    const where = inWorker ? "in its worker thread" : "on the main thread";

    it(`reaches the daemon's requestGroup with the paths ${where}`, async () => {
      const asked: Asked[] = [];
      const socketPath = await open(inWorker, (group, _held, paths) => {
        asked.push({ group, paths });
        return Promise.resolve(TAKEN);
      });
      const request = { type: "run-group-paths", group: "e2e", paths: ["src/a.ts"] } as const;
      const id = requestId(await requestDaemon(socketPath, request, 2_000));
      for (;;) {
        const state = await requestDaemon(
          socketPath,
          { type: "run-group-status", requestId: id },
          2_000,
        );
        if (!state.ok || state.type !== "run-group") throw new Error(JSON.stringify(state));
        if (state.requested !== null) {
          expect(state.narrow).toEqual(NARROW);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(asked).toEqual([{ group: "e2e", paths: ["src/a.ts"] }]);
    });
  }
});
