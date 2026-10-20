import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { STATUS_WAIT_SETTLE_MS } from "../../src/cli/status-wait.js";
import { namedLine } from "../../src/cli/status-wait-lines.js";
import { namedCode } from "../../src/cli/status-wait-paths.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import type { RevisionNumber } from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { A, ADDS, B, C, fail, INCARNATION, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-28 (005 D2 as amended 2026-10-20, gh-42; `tasks/011-24/design.md`
 * section 1.5): `squeal status <path>...` without `--wait` answers once with
 * the named wait's lines, after one sync of at most 750 ms, promotes
 * nothing, words its last line as a snapshot, and exits as D1 for the
 * selected files: 0, 1 with a known failure among them, 3 without a verdict.
 */

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

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
  const started = performance.now();
  const code = await main(argv, io);
  return { code, stdout, stderr, ms: performance.now() - started };
}

/** The daemon's answer to `sync`: its pass stored at `revision`, or not yet (`null`). */
const synced = (revision: number | null): Answer => ({
  ok: true,
  type: "sync",
  requestId: "y1",
  revision,
  error: null,
  moves: true,
  incarnation: INCARNATION,
});

/** A daemon on the worktree's socket that answers `sync`; resolves to the request types it got. */
function daemon(mainId: string, revision: number | null) {
  return fakeDaemon(socketPathFor(mainId), {
    sync: [synced(revision)],
    "sync-status": [synced(revision)],
  });
}

/** Two test files without a key, as a worktree with no dependencies installed has them. */
function unkeyed(repo: ReturnType<typeof repoWith>) {
  repo.store.testFileKeys.upsertMany(
    [B, C].map((path) => ({
      worktreeId: repo.repo.mainId,
      testFile: ref(path),
      key: null,
      revision: 4 as RevisionNumber,
      pending: null,
    })),
  );
}

describe("squeal status <path>... (005 D2 as amended, gh-42)", () => {
  it("answers gh-42's two files without --wait: no daemon, no verdict, exit 3, no worktree lines", async () => {
    const seeded = repoWith([], [A]);
    unkeyed(seeded);
    const row = seeded.store.worktrees.get(seeded.repo.mainId);
    if (row === null) throw new Error("no worktree");
    seeded.store.worktrees.upsert({ ...row, daemon: null });

    const result = await run(["status", B, C], seeded.repo.main);

    expect(result.code).toBe(3);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("Revision: 4");
    expect(lines[1]).toBe(`Selected: ${B}, ${C}`);
    expect(lines[2]).toBe("Unknown (2):");
    expect(lines.at(-1)).toMatch(
      /^Named test files have no verdict at revision 4: no daemon is running; `squeal start` starts one\. Worktree: known failures 0; /,
    );
    expect(result.stdout).not.toMatch(/^(Known failures|Affected checks|Worktree|Daemon):/m);
  });

  it("gives the selected files' verdict once the daemon's pass is stored, exit 0, and promotes nothing", async () => {
    const { repo } = repoWith([B], [A]);
    const seen = await daemon(repo.mainId, 4);

    const result = await run(["status", A], repo.main);

    expect(result.code).toBe(0);
    expect(result.stdout.split("\n")).toEqual([
      "Revision: 4",
      `Selected: ${A}`,
      expect.stringMatching(
        /^Named test files at revision 4: no known failures; 1 test file, each with a current result\. Worktree: known failures 0; not current: 1 of 2 test files \(1 queued\)/,
      ),
      "",
    ]);
    expect(seen).toContain("sync");
    expect(seen).not.toContain("promote");
    expect(result.ms).toBeLessThan(STATUS_WAIT_SETTLE_MS);
  });

  it("exits 1 with a known failure among the selected files, listed in full", async () => {
    const { repo, store } = repoWith([], [A, B]);
    fail(store, repo.mainId, ADDS);
    await daemon(repo.mainId, 4);

    const result = await run(["status", A, B], repo.main);

    expect(result.code).toBe(1);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "Revision: 4",
      `Selected: ${A}, ${B}`,
      `  FAIL  ${A} > adds`,
    ]);
    expect(lines.at(-1)).toMatch(
      /^Named test files at revision 4: 1 known failure: 1 test; 2 test files, each with a current result\. /,
    );
  });

  it("gives no verdict when the daemon has not stored its pass within 750 ms, though the files read current", async () => {
    const { repo } = repoWith([], [A]);
    const seen = await daemon(repo.mainId, null);

    const result = await run(["status", A], repo.main);

    expect(result.code).toBe(3);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^Named test files have no verdict: results are as of revision 4; the daemon has not stored its pass over the latest edits\. Worktree: /,
    );
    expect(result.stdout).not.toContain("each with a current result");
    expect(result.ms).toBeGreaterThanOrEqual(STATUS_WAIT_SETTLE_MS - 5);
    expect(result.ms).toBeLessThan(STATUS_WAIT_SETTLE_MS + 1_000);
    expect(seen).not.toContain("promote");
  });

  it("gives no verdict when the daemon cannot answer its sync, though its heartbeat is fresh (review of cand/0.1.233, B1)", async () => {
    const { repo } = repoWith([], [A]);
    // A pass that failed: the sync answers with an error, as a paused or
    // socketless daemon leaves it unanswered; the files read current at 4.
    const seen = await fakeDaemon(socketPathFor(repo.mainId), {
      sync: [{ ...synced(null), error: "the pass failed" }],
    });

    const result = await run(["status", A], repo.main);

    expect(result.code).toBe(3);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^Named test files have no verdict: results are as of revision 4; the daemon did not answer its sync, so they may not hold the latest edits\. Worktree: /,
    );
    expect(result.stdout).not.toContain("each with a current result");
    expect(seen).not.toContain("promote");
  });

  it("gives no verdict when the daemon's socket is gone, though its heartbeat is fresh (review of cand/0.1.233, B1)", async () => {
    // No daemon listens on the socket: the sync cannot be asked at all.
    const { repo } = repoWith([], [A]);

    const result = await run(["status", A], repo.main);

    expect(result.code).toBe(3);
    expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^Named test files have no verdict: results are as of revision 4; the daemon did not answer its sync, so they may not hold the latest edits\. Worktree: /,
    );
  });

  it("puts the named payload beside the snapshot with --json, outcome snapshot, the lines on stderr", async () => {
    const { repo } = repoWith([], [A]);
    await daemon(repo.mainId, 4);

    const result = await run(["status", "--json", A], repo.main);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.revision).toBe(4);
    expect(payload.named).toMatchObject({ outcome: "snapshot", code: 0, unmatched: [] });
    expect(payload.named.waitedMs).toEqual(expect.any(Number));
    expect(payload.named.testFiles).toEqual([{ ...ref(A), state: "current", verdict: "pass" }]);
    expect(payload.wait).toBeUndefined();
    expect(result.stderr).toMatch(
      new RegExp(
        `^Selected: ${A}\\nNamed test files at revision 4: no known failures; [^\\n]*\\n$`,
      ),
    );
  });

  it("prints the worktree's status first with --full", async () => {
    const { repo } = repoWith([], [A]);
    await daemon(repo.mainId, 4);

    const result = await run(["status", "--full", A], repo.main);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Revision: 4\nKnown failures: 0/);
    // Review of cand/0.1.234: `--full` is the full status, its detail block included (row 011-29).
    expect(result.stdout).toMatch(/\nWorktree: [^\n]*\nDaemon: [^\n]*\n/);
    expect(result.stdout).toContain("\nClosure method: ");
    expect(result.stdout).not.toContain("\nMore: ");
    expect(result.stdout).toMatch(
      /\n\nSelected: src\/a\.test\.ts\nNamed test files at revision 4: /,
    );
  });

  it("names --full's commands from the directory the paths were given in", async () => {
    // Review of cand/0.1.234, B1: the full status's commands resolve as `retry` reads its arguments.
    const { repo, store } = repoWith([], [A, B]);
    store.knownStates.upsertMany([
      state(repo.mainId, check(B, "holds"), {
        validity: "stale",
        pendingPhase: null,
        observedAt: 3,
      }),
    ]);
    await daemon(repo.mainId, 4);
    mkdirSync(join(repo.main, "src"), { recursive: true });

    const result = await run(["status", "--full", "a.test.ts"], join(repo.main, "src"));

    expect(result.stdout).toContain("`squeal retry b.test.ts`");
    expect(result.stdout).not.toContain("squeal retry src/b.test.ts");
  });

  it("exits 3 with D2's text for a path that selects nothing", async () => {
    const { repo } = repoWith([], [A]);
    await daemon(repo.mainId, 4);

    const result = await run(["status", "src/none.ts"], repo.main);

    expect(result.code).toBe(3);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      "Revision: 4",
      expect.stringMatching(/^No verdict: no test file's closure holds src\/none\.ts\. Worktree: /),
    ]);
  });
});

/** A sync that stores its pass at `revision` after `answerMs`, and says when it answered. */
function answersAfter(answerMs: number, revision = 4) {
  return (): DaemonSync => {
    const at = performance.now() + answerMs;
    const state = (): SyncState =>
      performance.now() >= at
        ? { state: "synced", revision: revision as RevisionNumber, incarnation: null }
        : { state: "pending" };
    return {
      current: state,
      answered: new Promise((r) => setTimeout(r, answerMs)),
      stop: () => {},
    };
  };
}

async function snapshotOf(root: string, paths: string[], sync: () => DaemonSync) {
  const read = await readNamedSnapshot(root as never, paths, { now: () => NOW, sync });
  if (read.outcome === "unavailable") throw new Error("unavailable");
  return { read, line: namedLine(read), code: namedCode(read) };
}

describe("readNamedSnapshot (row 011-28)", () => {
  it("gives no verdict when the daemon's pass lands after 750 ms, and does not wait for it", async () => {
    const { repo } = repoWith([], [A]);
    const { read, line, code } = await snapshotOf(repo.main, [A], answersAfter(1_500));
    expect(code).toBe(3);
    expect(line).toMatch(
      /^Named test files have no verdict: results are as of revision 4; the daemon has not stored its pass over the latest edits\. /,
    );
    expect(read.waitedMs).toBeGreaterThanOrEqual(STATUS_WAIT_SETTLE_MS - 5);
    expect(read.waitedMs).toBeLessThan(1_500);
  });

  it("gives no verdict when the stored pass is past the revision it read", async () => {
    const { repo } = repoWith([], [A]);
    const { line, code } = await snapshotOf(repo.main, [A], answersAfter(0, 5));
    expect(code).toBe(3);
    expect(line).toMatch(
      /^Named test files have no verdict: the daemon's pass is at revision 5 and results are as of revision 4\. /,
    );
  });

  it("answers at once with a selected file pending, naming no deadline", async () => {
    const { repo } = repoWith([B], [A]);
    const { read, line, code } = await snapshotOf(repo.main, [A, B], answersAfter(0));
    expect(code).toBe(3);
    expect(read.waitedMs).toBeLessThan(STATUS_WAIT_SETTLE_MS);
    expect(line).toMatch(
      /^Named test files have no verdict: 1 test file still pending at revision 4: /,
    );
    expect(line).not.toContain("deadline");
  });
});
