import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import type { Store } from "../../src/core/types/index.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { A, ADDS, fail, finish, INCARNATION, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-286 (gh-130 option A, the human 2026-10-31; 011 C15): a named
 * wait whose own sync is stored, so the daemon listed every edit made
 * before it, and whose selected files each have a current result returns
 * their verdict, text, JSON and exit code, while the heartbeat is late. A
 * socket that only accepts proves nothing, and an unstored pass or a file
 * without a current result keeps exit 3 `lapsed`.
 */

const saved = { ...process.env };
let runtimeDir: string;
const timers: NodeJS.Timeout[] = [];
const hung: Server[] = [];

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CODEX_SESSION_ID;
});

afterEach(() => {
  for (const timer of timers.splice(0)) clearTimeout(timer);
  for (const server of hung.splice(0)) server.close();
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** The heartbeat, 20 s old by the CLI's clock: held back while the daemon answers. */
const STALE_AT = NOW - 20_000;

function heartbeat(store: Store, worktreeId: string, at: number) {
  const row = store.worktrees.get(worktreeId);
  if (row === null || row.daemon === null) throw new Error("no daemon recorded");
  store.worktrees.upsert({ ...row, daemon: { ...row.daemon, heartbeatAt: at } });
}

/** The daemon's answer to `sync` and `sync-status`: its pass stored at `revision`, or not yet (`null`). */
const synced = (revision: number | null): Answer => ({
  ok: true,
  type: "sync",
  requestId: "y1",
  revision,
  error: null,
  moves: true,
  incarnation: INCARNATION,
});

/** A daemon that answers ping and sync on the worktree's socket, its pass at `revision`. */
function answering(worktreeId: string, revision: number | null) {
  return fakeDaemon(socketPathFor(worktreeId), {
    sync: [synced(revision)],
    "sync-status": [synced(revision)],
  });
}

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
    now: () => NOW,
    env: {},
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

/** Issue 26: the verdict is the output's last line. */
const last = (text: string) => text.trimEnd().split("\n").at(-1) ?? "";

describe("a synced named wait through a late heartbeat (row 011-286)", { timeout: 20_000 }, () => {
  it("returns the pass of a selected file current at the synced revision, exit 0", async () => {
    const { repo, store } = repoWith([], [A]);
    heartbeat(store, repo.mainId, STALE_AT);
    await answering(repo.mainId, 4);

    const result = await run(["status", "--wait", "10000", A], repo.main);

    expect(result.code).toBe(0);
    expect(last(result.stdout)).toMatch(
      /^Named test files at revision 4: no known failures; 1 test file, each with a current result, after \d+\.\d s/,
    );
    expect(result.stdout).not.toContain("no verdict");
  });

  it("says pass in the JSON, settled before its deadline", async () => {
    const { repo, store } = repoWith([], [A]);
    heartbeat(store, repo.mainId, STALE_AT);
    await answering(repo.mainId, 4);

    const result = await run(["status", "--json", "--wait", "10000", A], repo.main);

    expect(result.code).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.selection).toMatchObject({ outcome: "settled", code: 0, result: "pass" });
    expect(json.selection.reason).toBeUndefined();
    // The snapshot beside it still says the heartbeat is late (row 011-276).
    expect(json.daemon).toMatchObject({ state: "down", heartbeatLate: { ageMs: 20_000 } });
  });

  it("returns the failure of a selected file current at the synced revision, exit 1", async () => {
    const { repo, store } = repoWith([], [A]);
    fail(store, repo.mainId, ADDS);
    heartbeat(store, repo.mainId, STALE_AT);
    await answering(repo.mainId, 4);

    const result = await run(["status", "--json", "--wait", "10000", A], repo.main);

    expect(result.code).toBe(1);
    const { selection } = JSON.parse(result.stdout);
    expect(selection).toMatchObject({ outcome: "settled", code: 1, result: "fail" });
    expect(last(result.stderr)).toMatch(
      /^Named test files at revision 4: 1 known failure: 1 test; 1 test file, each with a current result/,
    );
  });

  it("keeps exit 3 lapsed when the socket accepts and never answers the sync", async () => {
    const { repo, store } = repoWith([], [A]);
    heartbeat(store, repo.mainId, STALE_AT);
    const server = createServer(() => {});
    hung.push(server);
    await new Promise<void>((resolve) => server.listen(socketPathFor(repo.mainId), resolve));

    const result = await run(["status", "--json", "--wait", "3000", A], repo.main);

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).selection).toMatchObject({
      outcome: "timeout",
      result: "none",
      reason: "lapsed",
    });
  });

  it.each([
    ["not stored yet", null],
    ["stored at a revision past the results'", 5],
  ])("keeps exit 3 lapsed when the daemon's pass over an edit is %s", async (_, revision) => {
    const { repo, store } = repoWith([], [A]);
    heartbeat(store, repo.mainId, STALE_AT);
    await answering(repo.mainId, revision);

    const result = await run(["status", "--json", "--wait", "1500", A], repo.main);

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).selection).toMatchObject({
      outcome: "timeout",
      result: "none",
      reason: "lapsed",
    });
  });

  it("gives the pass once the daemon recovers and the pending file's run ends", async () => {
    const { repo, store } = repoWith([A]);
    heartbeat(store, repo.mainId, STALE_AT);
    const seen = await answering(repo.mainId, 4);
    // Past the wait's first reads: the heartbeat comes back, then the run ends.
    const poll = setInterval(() => {
      if (!seen.includes("sync")) return;
      clearInterval(poll);
      timers.push(setTimeout(() => heartbeat(store, repo.mainId, NOW - 1_000), 500));
      timers.push(setTimeout(() => finish(store, repo.mainId, A), 1_000));
    }, 20);
    timers.push(poll);

    const result = await run(["status", "--json", "--wait", "10000", A], repo.main);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).selection).toMatchObject({
      outcome: "settled",
      result: "pass",
    });
  });
});
