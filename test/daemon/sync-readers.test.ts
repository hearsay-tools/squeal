import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { prepareFrontDesk } from "../../src/core/daemon/desk.js";
import { createHandlers } from "../../src/core/daemon/handlers.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import type {
  AbsolutePath,
  DaemonResponse,
  RelativePath,
  RevisionNumber,
  SyncAnswer,
  TestFileRef,
} from "../../src/core/types/index.js";

/*
 * Row 011-234 (005 D2 as amended): a named wait's sync carries its source
 * paths, and the answer, once the pass is stored, names each path's readers
 * in the daemon's key index with the revision it reports. Additive: a sync
 * without paths answers as before.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ref = (path: string): TestFileRef => ({ project: "", path });
const settle = () => new Promise((resolve) => setImmediate(resolve));

function requestId(response: DaemonResponse): string {
  if (!response.ok || response.type !== "sync") throw new Error(JSON.stringify(response));
  return response.requestId;
}

/** A pass that answers at `revision` with each asked path's readers from `readers`. */
function pass(readers: Record<string, readonly TestFileRef[]>) {
  const asked: (readonly RelativePath[] | undefined)[] = [];
  const requestSync = (paths?: readonly RelativePath[]): Promise<SyncAnswer> => {
    asked.push(paths);
    const revision = 7 as RevisionNumber;
    if (paths === undefined) return Promise.resolve({ revision });
    return Promise.resolve({
      revision,
      readers: Object.fromEntries(paths.map((p) => [p, readers[p] ?? []])),
    });
  };
  return { asked, requestSync };
}

describe("the sync request's paths", () => {
  it("parses paths, refuses a list that is not of strings, and keeps a sync without them", () => {
    expect(parseRequest('{"type":"sync","paths":["src/a.ts"]}')).toEqual({
      type: "sync",
      paths: ["src/a.ts"],
    });
    expect(parseRequest('{"type":"sync","after":4}')).toEqual({ type: "sync" });
    for (const paths of ['"src/a.ts"', "[1]", '[""]']) {
      expect(parseRequest(`{"type":"sync","paths":${paths}}`)).toBe(
        '"paths" must be a list of non-empty strings',
      );
    }
  });

  it("answers the readers once the pass is stored, and none to a sync without paths", async () => {
    const { asked, requestSync } = pass({ "src/a.ts": [ref("test/a.test.ts")] });
    const handle = createHandlers({
      worktreeId: "0123456789abcdef" as never,
      root: "/" as never,
      squealVersion: "0.0.0-test",
      startedAt: 1 as never,
      token: "t",
      phase: () => "ready",
      requestFullSuite: () => new Promise(() => {}),
      requestSync,
      onActivity: () => {},
      onStop: () => {},
      onStepDown: () => {},
    });

    const first = handle({ type: "sync", paths: ["src/a.ts", "src/none.ts"] });
    expect(first).not.toHaveProperty("readers");
    const plain = requestId(handle({ type: "sync" }));
    await settle();

    expect(handle({ type: "sync-status", requestId: requestId(first) })).toMatchObject({
      revision: 7,
      readers: { "src/a.ts": [ref("test/a.test.ts")], "src/none.ts": [] },
    });
    expect(handle({ type: "sync-status", requestId: plain })).not.toHaveProperty("readers");
    expect(asked).toEqual([["src/a.ts", "src/none.ts"], undefined]);
  });
});

describe("the readers through the front desk", () => {
  it.each([
    { name: "in the worker thread", worker: true },
    { name: "on the main thread", worker: false },
  ])("carries the paths and a path every test reads, 900 readers, $name", async ({ worker }) => {
    const dir = mkdtempSync("/tmp/sq-readers-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "d.sock") as AbsolutePath;
    // As long as this repository's test paths: `test/integration/...` names run 40 to 60 characters.
    const every = Array.from({ length: 900 }, (_, i) =>
      ref(`test/integration/a-long-directory-name/file-${i}.test.ts`),
    );
    const { asked, requestSync } = pass({ "src/core/types/index.ts": every });
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
        requestSync,
        onStop: () => {},
        onStepDown: () => {},
        onFailure: () => {},
      },
    );
    cleanups.push(() => desk.close());
    desk.setPhase("ready");

    const ask = { type: "sync", paths: ["src/core/types/index.ts"] } as const;
    const id = requestId(await requestDaemon(socketPath, ask, 2_000));
    await expect.poll(() => asked).toEqual([["src/core/types/index.ts"]]);
    const status = { type: "sync-status", requestId: id } as const;
    await expect
      .poll(() => requestDaemon(socketPath, status, 2_000))
      .toMatchObject({ revision: 7, readers: { "src/core/types/index.ts": every } });
    // The answer has no bound but the CLI's 2 s timeout: about 64 KB here (row 011-234's notes).
    const bytes = JSON.stringify(await requestDaemon(socketPath, status, 2_000)).length;
    expect(bytes).toBeGreaterThan(60_000);
  });
});
