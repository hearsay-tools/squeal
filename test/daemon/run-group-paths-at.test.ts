import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type { AbsolutePath, RelativePath, RevisionNumber } from "../../src/core/types/common.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3): `status --at --run` marks its
 * `run-group-paths` request with `at`, and the daemon's main thread hears
 * the paths (`onAtRun`) before the request reaches the scheduler, so the
 * first run of them is already flagged. Without `at`, it hears nothing.
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

    it(`tells the main thread the paths before the request ${where}`, async () => {
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
          onAtRun: (paths: readonly RelativePath[]) => heard.push(`at ${paths.join(",")}`),
          requestFullSuite: () => new Promise(() => {}),
          requestSlowSuite: () => new Promise(() => {}),
          requestGroup: (group, _held, paths) => {
            heard.push(`group ${group} ${paths?.join(",")}`);
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
      await requestDaemon(socketPath, { ...plain, paths: ["a.test.ts"], at: true }, 2_000);
      for (let i = 0; heard.length < 3 && i < 200; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(heard).toEqual(["group e2e b.test.ts", "at a.test.ts", "group e2e a.test.ts"]);
    });
  }
});
