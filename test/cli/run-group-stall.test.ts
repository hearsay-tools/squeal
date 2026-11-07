import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { clientGone } from "./fake-daemon.js";

/*
 * Row 019-24 item 3 (review 0.1.397 S1): `squeal run <group> --wait <ms>`
 * against a daemon that answers its ping but not the group's requests. The
 * socket requests and sleeps are bound by the wait's one deadline, and a
 * socket that gives no answer is the no-verdict path, exit 3, with a
 * worded line, never a stack. Without `--wait` the command keeps exit 1.
 */

const E2E = "test/e2e/a.test.ts";

const saved = { ...process.env };
let runtimeDir: string;
const servers: Server[] = [];
const held: Socket[] = [];
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  for (const socket of held.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A worktree with group `e2e` at `stop`, one pending file of it, and a live daemon record. */
function worktree(): { root: string; socket: string } {
  const repo = fakeRepo();
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({
      checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
    }),
  );
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  const socket = join(runtimeDir, "daemon.sock");
  store.worktrees.setDaemon(id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  const key = `key-${E2E}` as CheckKey;
  const testFile = { project: "", path: E2E as never };
  store.testFileKeys.upsertMany([
    { worktreeId: id, testFile, key, revision: 3 as RevisionNumber, pending: "queued" },
  ]);
  store.knownStates.upsertMany([
    state(id, check(E2E, "works"), { validity: "pending", pendingPhase: "queued", observedAt: 3 }),
  ]);
  store.close();
  return { root: repo.main, socket };
}

/**
 * A stand-in daemon that answers each request by `answer`, or holds the
 * socket open without a word when it gives `null`.
 */
function stalling(path: string, answer: (type: string) => Record<string, unknown> | null) {
  return new Promise<void>((resolve) => {
    const server = createServer((socket) => {
      socket.on("error", clientGone);
      socket.once("data", (data) => {
        const { type } = JSON.parse(data.toString()) as { type: string };
        const reply = answer(type);
        if (reply === null) {
          held.push(socket);
          return;
        }
        socket.end(`${JSON.stringify({ schemaVersion: 1, ok: true, type, ...reply })}\n`);
      });
    });
    servers.push(server);
    server.listen(path, () => resolve());
  });
}

const PENDING = {
  requestId: "g1",
  group: "e2e",
  requested: null,
  unknown: false,
  error: null,
};

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const started = performance.now();
  const code = await main(argv, io);
  return { code, stdout, stderr, ms: performance.now() - started };
}

describe("squeal run <group> --wait on a daemon that does not answer (019-24 item 3)", {
  timeout: 20_000,
}, () => {
  it("bounds the run-group request by the wait and exits 3 with a worded line", async () => {
    const w = worktree();
    await stalling(w.socket, (type) => (type === "ping" ? {} : null));
    const result = await run(["run", "e2e", "--wait", "300"], w.root);
    expect(result.stdout).toBe(
      "No verdict: the daemon did not answer the request to run group e2e before the deadline; it may still take it once its current work allows\n",
    );
    expect(result.stderr).toBe("");
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(1_500);
  });

  it("bounds the run-group-status polls by the wait and exits 3 with the pending line", async () => {
    const w = worktree();
    await stalling(w.socket, (type) =>
      type === "ping" ? {} : type === "run-group" ? PENDING : null,
    );
    const result = await run(["run", "e2e", "--wait", "300"], w.root);
    expect(result.stdout).toBe(
      "Group e2e has no verdict: the deadline passed before the daemon took request g1; this daemon does not say what holds it. The request stays pending: wait again with squeal run e2e --wait.\n",
    );
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(1_500);
  });

  it("without --wait, words the 2 s socket bound on stderr and keeps exit 1", async () => {
    const w = worktree();
    await stalling(w.socket, (type) => (type === "ping" ? {} : null));
    const result = await run(["run", "e2e"], w.root);
    expect(result.stderr).toBe(
      "squeal: the daemon did not answer the request to run group e2e within 2 s; it may still take it once its current work allows\n",
    );
    expect(result.stdout).toBe("");
    expect(result.code).toBe(1);
    expect(result.ms).toBeLessThan(3_500);
  });

  it("goes on to the deadline when the wait's ping gets no answer", async () => {
    const w = worktree();
    let pings = 0;
    await stalling(w.socket, (type) => {
      if (type === "ping") return pings++ === 0 ? {} : null;
      return { ...PENDING, requested: { revision: 3, queued: 1 } };
    });
    const result = await run(["run", "e2e", "--wait", "5500"], w.root);
    expect(result.stdout.split("\n")[0]).toBe(
      "Group e2e has no verdict: the deadline passed with 1 test file pending at revision 3; the group goes on in the daemon",
    );
    expect(pings).toBe(2);
    expect(result.code).toBe(3);
    expect(result.ms).toBeLessThan(7_000);
  });
});
