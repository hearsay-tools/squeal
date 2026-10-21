import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { readNamedSnapshot } from "../../src/cli/status-paths.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { type NamedWaitOptions, namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import type { RevisionNumber, TestFileRef } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import {
  A,
  ADDS,
  B,
  fail,
  finish,
  INCARNATION,
  later,
  NOW,
  ref,
  repoWith,
  timed,
} from "./status-wait-fixture.js";

/*
 * Row 011-63 (gh-59, gh-65, the human 2026-10-21, triage round 9 group C): a
 * named wait whose paths select some test files and not others holds for the
 * files they select, promotes them, and names the paths that select nothing
 * beside their verdict: exit 1 with a known failure among them, else 3. Only
 * when no path selects a file does it return at once. Both JSON forms carry
 * the selection under `selection`; the snapshot's `named` and the wait's
 * `wait` stay.
 */

const NONE = "src/none.ts";
const unmatched = "no test file's closure holds src/none.ts";

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = () => (): DaemonSync => ({ current: synced, stop: () => {} });

function options(promoted: TestFileRef[][] = [], timeoutMs = 5_000): NamedWaitOptions {
  return {
    timeoutMs,
    pollMs: 20,
    settleMs: 100,
    now: () => NOW,
    sync: sync(),
    promote: (_root, files) => promoted.push([...files]),
  };
}

async function waitOn(root: string, paths: readonly string[], opts: NamedWaitOptions) {
  const wait = await waitForNamed(root, paths, opts);
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return wait;
}

const lastLine = (text: string) => text.trimEnd().split("\n").at(-1);

describe("a named wait with matched and unmatched paths (011-63, gh-59)", () => {
  it("holds for the matched file, promotes it, and names the unmatched path beside its verdict, exit 3", async () => {
    const { repo, store } = repoWith([A, B]);
    const promoted: TestFileRef[][] = [];
    const finished = later(300, () => finish(store, repo.mainId, A));

    const { wait, endedBy } = await timed(() => waitOn(repo.main, [A, NONE], options(promoted)));

    expect(wait.outcome).toBe("settled");
    expect(endedBy).toBeGreaterThanOrEqual(finished.at);
    expect(promoted).toEqual([[ref(A)]]);
    expect(wait.selection.unmatched).toEqual([NONE]);
    expect(namedCode(wait)).toBe(3);
    const text = namedText(wait, NOW);
    expect(text.split("\n")[1]).toBe(`Selected: ${A}`);
    expect(lastLine(text)).toMatch(
      new RegExp(
        `^Named test files have no verdict: ${unmatched}; the test files the other paths select at revision 4: no known failures; 1 test file, each with a current result, after \\d+\\.\\d s\\. Worktree: `,
      ),
    );
  });

  it("exits 1 when a matched file fails, the unmatched path beside the verdict", async () => {
    const { repo, store } = repoWith([B], [A]);
    fail(store, repo.mainId, ADDS);

    const wait = await waitOn(repo.main, [NONE, A], options());

    expect([wait.outcome, namedCode(wait)]).toEqual(["settled", 1]);
    expect(lastLine(namedText(wait, NOW))).toMatch(
      new RegExp(
        `^Named test files at revision 4: 1 known failure: 1 test; 1 test file, each with a current result, after \\d+\\.\\d s; ${unmatched}\\. Worktree: `,
      ),
    );
  });

  it("times out on the matched file with the unmatched path beside, exit 3", async () => {
    const { repo } = repoWith([A]);

    const wait = await waitOn(repo.main, [A, NONE], options([], 300));

    expect([wait.outcome, namedCode(wait)]).toEqual(["timeout", 3]);
    expect(wait.waitedMs).toBeGreaterThanOrEqual(299);
    expect(lastLine(namedText(wait, NOW))).toMatch(
      new RegExp(
        `^Named test files have no verdict: the deadline passed after \\d+\\.\\d s: [^\\n]*; ${unmatched}\\. Worktree: `,
      ),
    );
  });

  it("returns at once without a promotion when no path selects a file", async () => {
    const { repo } = repoWith([A]);
    const promoted: TestFileRef[][] = [];

    const wait = await waitOn(repo.main, [NONE, "src/other.ts"], options(promoted));

    expect([wait.outcome, namedCode(wait), promoted]).toEqual(["unmatched", 3, []]);
    expect(wait.waitedMs).toBeLessThan(5_000);
  });

  it("settles a snapshot on the matched file and names the unmatched path beside, exit 3", async () => {
    const { repo } = repoWith([], [A]);

    const snapshot = await readNamedSnapshot(repo.main, [A, NONE], {
      now: () => NOW,
      sync: sync(),
    });

    if (snapshot.outcome === "unavailable") throw new Error("unavailable");
    expect([snapshot.outcome, namedCode(snapshot)]).toEqual(["settled", 3]);
    expect(lastLine(namedText(snapshot, NOW))).toMatch(
      new RegExp(
        `^Named test files have no verdict: ${unmatched}; the test files the other paths select at revision 4: no known failures; 1 test file, each with a current result\\. Worktree: `,
      ),
    );
  });
});

describe("the selection's one JSON key (011-63, gh-65)", () => {
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

  /** A daemon on the worktree's socket whose pass is stored at revision 4. */
  async function daemon(mainId: string) {
    const answer = {
      ok: true,
      type: "sync",
      requestId: "y1",
      revision: 4,
      error: null,
      moves: true,
      incarnation: INCARNATION,
    };
    await fakeDaemon(socketPathFor(mainId), { sync: [answer], "sync-status": [answer] });
  }

  async function run(argv: string[], cwd: string) {
    let stdout = "";
    const io: CliIo = {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
      cwd,
      now: () => NOW,
      env: {},
    };
    const code = await main(argv, io);
    return { code, payload: JSON.parse(stdout) };
  }

  const cases = [
    { name: "passing", code: 0, entry: { state: "current", verdict: "pass" } },
    { name: "failing", code: 1, entry: { state: "current", verdict: "fail" } },
    { name: "pending", code: 3, entry: { state: "pending" } },
  ] as const;

  for (const { name, code, entry } of cases) {
    it(`carries a ${name} selection under \`selection\` in both forms, the old keys kept, exit ${code}`, async () => {
      const { repo, store } = name === "pending" ? repoWith([A]) : repoWith([], [A]);
      if (name === "failing") fail(store, repo.mainId, ADDS);
      await daemon(repo.mainId);

      const snapshot = await run(["status", "--json", A], repo.main);
      const wait = await run(["status", "--json", "--wait", "300", A], repo.main);

      expect([snapshot.code, wait.code]).toEqual([code, code]);
      for (const { payload } of [snapshot, wait]) {
        expect(payload.selection).toMatchObject({ code, unmatched: [] });
        expect(payload.selection.testFiles).toEqual([
          expect.objectContaining({ ...ref(A), ...entry }),
        ]);
      }
      expect(snapshot.payload.selection).toEqual(snapshot.payload.named);
      expect(snapshot.payload.wait).toBeUndefined();
      expect(wait.payload.selection).toEqual(wait.payload.wait);
      expect(wait.payload.named).toBeUndefined();
    });
  }

  it("lists the unmatched path under `selection` beside the matched file", async () => {
    const { repo } = repoWith([], [A]);
    await daemon(repo.mainId);

    for (const argv of [
      ["status", "--json"],
      ["status", "--json", "--wait", "3000"],
    ]) {
      const { code, payload } = await run([...argv, A, NONE], repo.main);
      expect(code, argv.join(" ")).toBe(3);
      expect(payload.selection, argv.join(" ")).toMatchObject({ code: 3, unmatched: [NONE] });
      expect(payload.selection.testFiles).toEqual([
        { ...ref(A), state: "current", verdict: "pass" },
      ]);
    }
  });
});
