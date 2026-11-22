import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-34 (review wave-20 B2): a narrow request of `status --at --run`
 * that named its files carries `lead`, which reaches the scheduler's
 * narrow run. Row 023-41 removed `owner`, the take-back's key; an `owner`
 * an older CLI sends is ignored.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("a narrow request's lead (review wave-20 B2)", () => {
  it("parses, ignores an older CLI's owner, and refuses anything else", () => {
    const line =
      '{"type":"run-group-paths","group":"tests","paths":["a"],"at":true,"owner":"o1","lead":true}';
    expect(parseRequest(line)).toEqual({
      type: "run-group-paths",
      group: "tests",
      paths: ["a"],
      at: true,
      lead: true,
    });
    expect(parseRequest('{"type":"run-group-paths","group":"t","paths":["a"],"lead":false}')).toBe(
      '"lead" must be true when given',
    );
  });

  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("reaches the scheduler's narrow run $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-lead-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    const asked: unknown[] = [];
    const prepared = prepareFrontDesk(
      worker
        ? {
            script: fileURLToPath(new URL("../../src/core/daemon/front-desk.ts", import.meta.url)),
            execArgv: [
              "--disable-warning=ExperimentalWarning",
              "--import",
              fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url)),
            ],
          }
        : null,
    );
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
        requestGroup: (group, _held, paths, options) => {
          asked.push({ group, paths, options });
          return new Promise(() => {});
        },
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");
    const request = {
      type: "run-group-paths",
      group: "tests",
      paths: ["test/a.test.ts"],
      lead: true,
    } as const;
    expect(await requestDaemon(socketPath, request, 2_000)).toMatchObject({ ok: true });
    await expect
      .poll(() => asked)
      .toEqual([{ group: "tests", paths: ["test/a.test.ts"], options: { lead: true } }]);
  });
});
