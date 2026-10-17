import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import {
  type CheckKey,
  type RevisionNumber,
  refinedMetaKey,
  type Store,
} from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { A, B, C, fail, key, NOW, ref, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Task 011-12 (011 C15's last two paragraphs, issues 17 and 23): for every
 * selected file still pending a named wait gives one reason with its bound,
 * and one that ends without a verdict lists the selected files by class,
 * with their verdicts, in text and in `wait.testFiles`.
 */

/** Local `HH:MM:SS` of `at`, as the line prints it. */
const clock = (at: number) => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const STARTED = NOW - 30_000;

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = () => (): DaemonSync => ({ current: synced, stop: () => {} });

async function timedOut(root: string, paths: readonly string[]) {
  const wait = await waitForNamed(root, paths, {
    timeoutMs: 60,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: sync(),
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return { wait, text: namedText(wait, NOW) };
}

function openRun(store: Store, worktreeId: string, id: string, paths: readonly string[]) {
  store.runs.start({
    id,
    worktreeId,
    revision: 4 as RevisionNumber,
    testFiles: paths.map(ref),
    checkpointId: null,
    logDir: `/tmp/${id}`,
    startedAt: STARTED,
  });
}

/** `path`'s row as running, as `startTier` writes it, with its check running. */
function running(store: Store, worktreeId: string, path: string) {
  key(store, worktreeId, path, "running");
  store.knownStates.upsertMany([
    state(worktreeId, check(path, "holds"), { validity: "pending", pendingPhase: "running" }),
  ]);
}

describe("a named wait names what holds each pending selected file (011-12)", () => {
  it("running since in its lane, and queued behind that lane's tier", async () => {
    const { repo, store } = repoWith([B]);
    running(store, repo.mainId, A);
    openRun(store, repo.mainId, "run-a", [A]);

    const { wait, text } = await timedOut(repo.main, [A, B]);

    expect(wait.outcome).toBe("timeout");
    expect(text).toContain(
      `Pending (2): ${A}: running since ${clock(STARTED)} in the vitest lane; ${B}: queued behind the vitest tier running since ${clock(STARTED)}\n`,
    );
    expect(text.trimEnd().split("\n").at(-1)).toContain(`the deadline passed after 0.`);
    expect(text.trimEnd().split("\n").at(-1)).toContain(
      `2 test files still pending at revision 4: 1 running since ${clock(STARTED)} in the vitest lane, 1 queued behind the vitest tier running since ${clock(STARTED)}. Worktree:`,
    );
  });

  it("queued behind its own open run after a re-key queued it under its new key", async () => {
    const { repo, store } = repoWith([A]);
    openRun(store, repo.mainId, "run-a", [A]);

    const { text } = await timedOut(repo.main, [A]);

    expect(text).toContain(
      `Pending (1): ${A}: queued behind the vitest tier running since ${clock(STARTED)}\n`,
    );
  });

  it("waiting for another worktree's run of its key, at most until that claim's bound", async () => {
    const { repo, store } = repoWith([C]);
    const other = repo.addWorktree("other");
    store.worktrees.upsert({
      id: other.id,
      root: other.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 2,
      daemon: {
        socketPath: "/tmp/other.sock",
        startedAt: NOW - 60_000,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });
    const own = store.testFileKeys.list(repo.mainId, [ref(C)])[0]?.key as CheckKey;
    store.testFileKeys.upsertMany([
      {
        worktreeId: other.id,
        testFile: ref(C),
        key: own,
        revision: 1 as never,
        pending: "running",
      },
    ]);
    openRun(store, other.id, "run-other", [C]);

    const { text } = await timedOut(repo.main, [C]);

    // Default runner.timeoutMs 600 s plus C7's 6 s grace, from the claimant's run start.
    expect(text).toContain(
      `${C}: waiting for ${other.root}'s run of its key, at most until ${clock(STARTED + 606_000)}`,
    );
  });

  it("slow, run when the agent pauses or on run --slow", async () => {
    const { repo } = repoWith([SLOW_FILE]);
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: ["test/slow.test.ts"] } }),
    );

    const { text } = await timedOut(repo.main, [SLOW_FILE]);

    expect(text).toContain(
      `Pending (1): ${SLOW_FILE}: slow, run when the agent pauses or on \`squeal run --slow\`\n`,
    );
  });

  it("revision not listed yet, with the runner part's time left", async () => {
    const { repo, store } = repoWith([A]);
    store.revisions.append({
      worktreeId: repo.mainId,
      createdAt: NOW - 10_000,
      head: null,
      dirty: false,
      trigger: "watch",
      changes: [{ path: "vitest.config.ts", oldHash: "a", newHash: "b" }],
    });
    store.meta.set(refinedMetaKey(repo.mainId), "4");

    const { text } = await timedOut(repo.main, [A]);

    // 600 s run timeout + 6 s grace + 60 s margin, 10 s of it gone.
    const reason =
      "revision 5 not listed yet, because the runner part waits for the run in flight, at most 656 s more";
    expect(text).toContain(`Pending (1): ${A}: ${reason}\n`);
    expect(text).toContain(
      `the runner has not listed the test files of revision 5 yet: 1 ${reason}. Worktree:`,
    );
  });
});

describe("a timed-out named wait lists the selected files by class with verdicts (011-12, issue 23)", () => {
  /** Eleven files: 4 current (one failing), 3 pending, 2 stale, 2 unknown. */
  function eleven() {
    const current = ["c1", "c2", "c3", "c4"].map((n) => `src/${n}.test.ts`);
    const pending = ["p1", "p2", "p3"].map((n) => `src/${n}.test.ts`);
    const stale = ["s1", "s2"].map((n) => `src/${n}.test.ts`);
    const unknown = ["u1", "u2"].map((n) => `src/${n}.test.ts`);
    const { repo, store } = repoWith(pending, [...current, ...stale]);
    const id = repo.mainId;
    fail(store, id, check("src/c4.test.ts", "holds"));
    store.knownStates.upsertMany(
      stale.map((p) =>
        state(id, check(p, "holds"), {
          validity: "stale",
          outcome: p.endsWith("s2.test.ts") ? "fail" : "pass",
        }),
      ),
    );
    key(store, id, "src/u1.test.ts", null);
    store.testFileKeys.upsertMany([
      {
        worktreeId: id,
        testFile: ref("src/u2.test.ts"),
        key: null,
        revision: 4 as never,
        pending: null,
      },
    ]);
    return { repo, all: [...current, ...pending, ...stale, ...unknown] };
  }

  it("in text: each class with its files, verdicts and reasons, and the failure in full", async () => {
    const { repo, all } = eleven();

    const { text, wait } = await timedOut(repo.main, all);

    expect(wait.outcome).toBe("timeout");
    const lines = text.trimEnd().split("\n");
    const at = lines.findIndex((l) => l.startsWith("Selected: "));
    expect(lines.slice(at)).toEqual([
      "Selected: src/c1.test.ts, src/c2.test.ts, src/c3.test.ts, src/c4.test.ts, src/p1.test.ts, src/p2.test.ts, src/p3.test.ts, src/s1.test.ts, src/s2.test.ts, src/u1.test.ts and 1 more",
      "  FAIL  src/c4.test.ts > holds",
      "        observed at revision 4, current",
      "  FAIL  src/s2.test.ts > holds",
      "        observed at revision 1, stale",
      "Pending (3): src/p1.test.ts: queued; src/p2.test.ts: queued; src/p3.test.ts: queued",
      "Current (4): src/c1.test.ts: pass; src/c2.test.ts: pass; src/c3.test.ts: pass; src/c4.test.ts: fail",
      "Stale (2): src/s1.test.ts: last pass; src/s2.test.ts: last fail",
      "Unknown (2): src/u1.test.ts: no result: never run at this key, and nothing queued it; src/u2.test.ts: no result: no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked",
      expect.stringMatching(
        /^Named test files have no verdict: the deadline passed after \d+\.\d s: 3 test files still pending at revision 4: 3 queued\. Worktree: /,
      ),
    ]);
  });

  it("in JSON: every wait.testFiles entry carries its state, a verdict when known and a reason", async () => {
    const { repo, all } = eleven();
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      stdout: (t) => {
        stdout += t;
      },
      stderr: (t) => {
        stderr += t;
      },
      cwd: repo.main,
      now: () => NOW,
      env: {},
    };

    const code = await main(["status", "--json", "--wait", "200", ...all], io);

    expect(code).toBe(3);
    const entries = JSON.parse(stdout).wait.testFiles;
    expect(entries).toHaveLength(11);
    const by = Object.fromEntries(entries.map((e: { path: string }) => [e.path, e]));
    expect(by["src/c1.test.ts"]).toEqual({
      project: "",
      path: "src/c1.test.ts",
      state: "current",
      verdict: "pass",
    });
    expect(by["src/c4.test.ts"]).toMatchObject({ state: "current", verdict: "fail" });
    expect(by["src/p1.test.ts"]).toEqual({
      project: "",
      path: "src/p1.test.ts",
      state: "pending",
      reason: "queued",
    });
    expect(by["src/s2.test.ts"]).toMatchObject({ state: "stale", verdict: "fail" });
    expect(by["src/u1.test.ts"]).toEqual({
      project: "",
      path: "src/u1.test.ts",
      state: "unknown",
      reason: "no result: never run at this key, and nothing queued it",
    });
    expect(stderr).toContain("Pending (3): ");
    expect(stderr.trimEnd().split("\n").at(-1)).toMatch(/^Named test files have no verdict: /);
  });
});
