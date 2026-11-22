import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import {
  AT_RUN_TTL_MS,
  AtRunRequests,
  flagAccepted,
} from "../../src/core/daemon/run-groups-watch.js";
import type { AbsolutePath, RevisionNumber } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3; review wave-20 B8): `status --at
 * --run` marks its `run-group-paths` request with `at`, which reaches the
 * daemon's main thread with the request. Only a request the scheduler
 * accepted flags its selected files, by project and path; a refused one
 * flags nothing, and its run or an hour ends the flag. Row 023-41 removed
 * the take-back and the call's `owner`; the covered-files id keys a flag.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("run-group-paths with at (023-36)", () => {
  it("parses `at: true`, refuses any other value, and leaves it out when absent", () => {
    expect(
      parseRequest('{"type":"run-group-paths","group":"e2e","paths":["a.test.ts"],"at":true}'),
    ).toEqual({ type: "run-group-paths", group: "e2e", paths: ["a.test.ts"], at: true });
    expect(
      parseRequest('{"type":"run-group-paths","group":"e2e","paths":["a.test.ts"],"at":"yes"}'),
    ).toBe('"at" must be true when given');
    expect(
      parseRequest('{"type":"run-group-paths","group":"e2e","paths":["a.test.ts"]}'),
    ).not.toHaveProperty("at");
  });

  const worker = {
    script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
    execArgv: [
      "--disable-warning=ExperimentalWarning",
      "--import",
      fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
    ],
  };

  for (const inWorker of [false, true]) {
    const where = inWorker ? "in its worker thread" : "on the main thread";

    it(`hands \`at\` to the main thread with its request only ${where}`, async () => {
      const heard: string[] = [];
      const dir = mkdtempSync("/tmp/sq-at-run-");
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
          requestGroup: (group, _held, paths, options) => {
            heard.push(`group ${group} ${paths?.join(",")}${options?.at === true ? " at" : ""}`);
            return Promise.resolve({ revision: 1 as RevisionNumber, queued: 1 });
          },
          requestSync: () => new Promise(() => {}),
          onStop: () => {},
          onStepDown: () => {},
          onFailure: () => {},
        },
      );
      cleanups.push(() => desk.close());
      desk.setPhase("ready");
      const plain = { type: "run-group-paths", group: "e2e", paths: ["b.test.ts"] } as const;
      await requestDaemon(socketPath, plain, 2_000);
      const at = { ...plain, paths: ["a.test.ts"], at: true } as const;
      await requestDaemon(socketPath, at, 2_000);
      for (let i = 0; heard.length < 2 && i < 200; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(heard).toEqual(["group e2e b.test.ts", "group e2e a.test.ts at"]);
    });
  }
});

const A: TestFileRef = { project: "unit", path: "a.test.ts" };
const A_ELSEWHERE: TestFileRef = { project: "e2e", path: "a.test.ts" };
const B: TestFileRef = { project: "unit", path: "b.test.ts" };
describe("which runs an at request flags (023-36, B8)", () => {
  it("flags nothing for a refused, unknown or plain request", () => {
    const requests = new AtRunRequests();
    flagAccepted(requests, null, { at: true });
    flagAccepted(requests, { coveredId: "c1" }, { at: true });
    flagAccepted(requests, { newlyQueued: [A], coveredId: "c3" }, { lead: true });
    flagAccepted(requests, { newlyQueued: [A], coveredId: "c2" }, undefined);
    expect(requests.flagged([A])).toBe(false);
  });

  it("flags an accepted request's files by project and path, a mixed batch included", () => {
    const requests = new AtRunRequests();
    flagAccepted(requests, { newlyQueued: [A], coveredId: "c1" }, { at: true });
    expect(requests.flagged([A])).toBe(true);
    expect(requests.flagged([A_ELSEWHERE])).toBe(false);
    expect(requests.flagged([B, A])).toBe(true);
    expect(requests.flagged([B])).toBe(false);
  });

  it("flags exactly what the request queued itself: not a file current, queued by another or running", () => {
    const requests = new AtRunRequests();
    flagAccepted(requests, { newlyQueued: [], coveredId: "c1" }, { at: true });
    flagAccepted(requests, { coveredId: "c2" }, { at: true });
    expect(requests.flagged([A])).toBe(false);
    // Selected [A, B]; A was current, so the request queued only B.
    flagAccepted(requests, { newlyQueued: [B], coveredId: "c3" }, { at: true });
    expect(requests.flagged([A])).toBe(false);
    expect(requests.flagged([B])).toBe(true);
  });

  it("ends the flag when the files ran, or after the hour", () => {
    let now = 0;
    const requests = new AtRunRequests(() => now);
    requests.accepted("c1", [A]);
    requests.ran([A]);
    expect(requests.flagged([A])).toBe(false);
    requests.accepted("c3", [A]);
    now = AT_RUN_TTL_MS;
    expect(requests.flagged([A])).toBe(false);
  });
});
