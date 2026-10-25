import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { SyncState } from "../../src/cli/status-sync.js";
import {
  type FileVerdict,
  resultCode,
  type SelectionRead,
  selectionResult,
} from "../../src/cli/verdict.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { askRetry } from "../../src/core/retry/index.js";
import type { CheckKey, RevisionNumber } from "../../src/core/types/index.js";
import { check } from "../status/helpers.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { A, fail, INCARNATION, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-206 (gh-88, gh-84, gh-83; 011 C15): a selection's result word,
 * pass, fail or none, and for none the one reason from a closed list, from
 * one function the exit code, the JSON and the verdict line read.
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

const verdict = (overrides: Partial<FileVerdict> = {}): FileVerdict => ({
  revision: 4 as RevisionNumber,
  testFiles: 2,
  byClass: { current: 2, pending: 0, stale: 0, unknown: 0 },
  unlisted: false,
  failures: { tests: 0, testFiles: 0 },
  ...overrides,
});
const SYNCED: SyncState = { state: "synced", revision: 4 as RevisionNumber, incarnation: null };
const read = (overrides: Partial<SelectionRead> = {}): SelectionRead => ({
  outcome: "settled",
  verdict: verdict(),
  sync: SYNCED,
  unmatched: 0,
  notRun: 0,
  ...overrides,
});
const PENDING = verdict({ byClass: { current: 1, pending: 1, stale: 0, unknown: 0 } });
const FAILED = verdict({ failures: { tests: 1, testFiles: 0 } });

describe("selectionResult (row 011-206)", () => {
  it.each<[string, Partial<SelectionRead>, string]>([
    ["every file current and passing", {}, "pass"],
    ["a current failure", { verdict: FAILED }, "fail"],
    ["a failure beside a path that selects nothing", { verdict: FAILED, unmatched: 1 }, "fail"],
    ["a failure beside a test file Squeal does not run", { verdict: FAILED, notRun: 1 }, "fail"],
    ["a focused answer with no failed check", { outcome: "focused" }, "none: focused"],
    ["no daemon", { outcome: "no-daemon", verdict: PENDING }, "none: no-daemon"],
    [
      "a lapsed heartbeat beside a pending file",
      { outcome: "timeout", lapsed: true, verdict: PENDING },
      "none: lapsed",
    ],
    [
      "a lapsed heartbeat beside an unstored pass",
      { outcome: "timeout", lapsed: true, sync: { state: "pending" } },
      "none: lapsed",
    ],
    ["a queued file on hold", { outcome: "on-hold", verdict: PENDING }, "none: on-hold"],
    ["only slow files left for a pause", { outcome: "slow" }, "none: paused"],
    [
      "the pass not stored, every file current (gh-88)",
      { outcome: "timeout", sync: { state: "pending" } },
      "none: unsynced",
    ],
    [
      "the pass past the results' revision",
      { outcome: "timeout", sync: { ...SYNCED, revision: 5 as RevisionNumber } },
      "none: unsynced",
    ],
    [
      "a snapshot whose sync the daemon did not answer",
      { outcome: "timeout", snapshot: true, sync: { state: "unsupported" } },
      "none: unsynced",
    ],
    [
      "the revision not listed beside a pending file",
      { outcome: "timeout", verdict: { ...PENDING, unlisted: true } },
      "none: unlisted",
    ],
    [
      "a wait's unanswered sync, a file pending",
      { outcome: "timeout", sync: { state: "unsupported" }, verdict: PENDING },
      "none: pending",
    ],
    [
      "every file current at the deadline, a focused run out",
      { outcome: "timeout" },
      "none: pending",
    ],
    [
      "a stale file",
      { verdict: verdict({ byClass: { current: 1, pending: 0, stale: 1, unknown: 0 } }) },
      "none: not-current",
    ],
    [
      "a stale file beside a failure",
      {
        verdict: verdict({
          byClass: { current: 1, pending: 0, stale: 0, unknown: 1 },
          failures: { tests: 1, testFiles: 0 },
        }),
      },
      "none: not-current",
    ],
    [
      "a test file Squeal does not run beside passing readers",
      { notRun: 1, unmatched: 1 },
      "none: not-run",
    ],
    ["a path that selects nothing beside passing files", { unmatched: 1 }, "none: unmatched"],
    ["no path selects a file", { outcome: "unmatched", unmatched: 1 }, "none: unmatched"],
    [
      "no path selects a file, one Squeal does not run",
      { outcome: "unmatched", unmatched: 1, notRun: 1 },
      "none: not-run",
    ],
  ])("%s: %s", (_, overrides, expected) => {
    const got = selectionResult(read(overrides));
    const word = got.result === "none" ? `none: ${got.reason}` : got.result;
    expect(word).toBe(expected);
    expect(resultCode(got)).toBe(got.result === "pass" ? 0 : got.result === "fail" ? 1 : 3);
  });

  it("gives fail for a focused answer with a failed check", () => {
    expect(selectionResult(read({ outcome: "focused", focusFailed: true }))).toEqual({
      result: "fail",
    });
  });
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
  const code = await main(argv, io);
  return { code, stdout, stderr };
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

/** gh-88's selection: 24 test files, each current and passing. */
const FILES = Array.from(
  { length: 24 },
  (_, n) => `src/f${String(n + 1).padStart(2, "0")}.test.ts`,
);
const OTHER = "src/other.test.ts";

describe("status <path>... gives the selection's word and reason (row 011-206, gh-88)", () => {
  it("24 current passes with the daemon's pass not stored: exit 3 and unsynced, in the text and the JSON", async () => {
    const { repo } = repoWith([], FILES);
    const answers = { sync: [synced(null)], "sync-status": [synced(null)] };
    await fakeDaemon(socketPathFor(repo.mainId), answers);

    const text = await run(["status", ...FILES], repo.main);
    const json = await run(["status", "--json", ...FILES], repo.main);

    expect(text.code).toBe(3);
    expect(text.stdout.trimEnd().split("\n").at(-1)).toMatch(
      /^Named test files have no verdict: results are as of revision 4; the daemon has not stored its pass over the latest edits\. /,
    );
    expect(json.code).toBe(3);
    const { selection } = JSON.parse(json.stdout);
    expect(selection).toMatchObject({ code: 3, result: "none", reason: "unsynced" });
    expect(selection.testFiles).toHaveLength(24);
    expect(selection.testFiles.every((f: { state: string }) => f.state === "current")).toBe(true);
  });

  it("the same selection with the pass stored gives 0 and pass beside an unrelated current failure and a pending load retry", async () => {
    const { repo, store } = repoWith([], [...FILES, OTHER]);
    fail(store, repo.mainId, check(OTHER, "holds"));
    const key = store.testFileKeys.list(repo.mainId).find((r) => r.testFile.path === OTHER)?.key;
    askRetry(store, {
      testFile: ref(OTHER),
      key: key as CheckKey,
      session: "s1",
      reason: "load",
      at: NOW,
      worktreeId: repo.mainId,
    });
    await fakeDaemon(socketPathFor(repo.mainId), { sync: [synced(4)], "sync-status": [synced(4)] });

    const result = await run(["status", "--json", ...FILES], repo.main);

    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.selection).toMatchObject({ code: 0, result: "pass" });
    expect(payload.selection.reason).toBeUndefined();
    expect(payload.pendingRetries.retries).toMatchObject([
      { testFile: ref(OTHER), reason: "load" },
    ]);
    expect(result.stderr).toMatch(
      /\nNamed test files at revision 4: no known failures; 24 test files, each with a current result\. Worktree: known failures 1/,
    );
  });

  it("a current failure among the selection gives 1 and fail", async () => {
    const { repo, store } = repoWith([], FILES);
    fail(store, repo.mainId, check(FILES[0] as string, "holds"));
    await fakeDaemon(socketPathFor(repo.mainId), { sync: [synced(4)], "sync-status": [synced(4)] });

    const result = await run(["status", "--json", ...FILES], repo.main);

    expect(result.code).toBe(1);
    const { selection } = JSON.parse(result.stdout);
    expect(selection).toMatchObject({ code: 1, result: "fail" });
    expect(selection.reason).toBeUndefined();
  });
});

describe("a named wait whose daemon's heartbeat lapsed (row 011-206)", () => {
  it("says lapsed beside a pending file, in the JSON and the verdict line", async () => {
    const { repo, store } = repoWith([A]);
    const row = store.worktrees.get(repo.mainId);
    if (row === null || row.daemon === null) throw new Error("no daemon recorded");
    // 20 s old by the CLI's clock, while the daemon still answers on its socket.
    store.worktrees.upsert({ ...row, daemon: { ...row.daemon, heartbeatAt: NOW - 20_000 } });
    await fakeDaemon(socketPathFor(repo.mainId), { sync: [synced(4)], "sync-status": [synced(4)] });

    const result = await run(["status", "--json", "--wait", "1500", A], repo.main);

    expect(result.code).toBe(3);
    expect(JSON.parse(result.stdout).selection).toMatchObject({
      outcome: "timeout",
      result: "none",
      reason: "lapsed",
    });
    expect(result.stderr.trimEnd().split("\n").at(-1)).toMatch(
      /^Named test files have no verdict: the deadline passed after 1\.\d s: the daemon's heartbeat had lapsed at the last read; results are as of revision 4; the daemon's heartbeat went 20 s stale /,
    );
  });
});
