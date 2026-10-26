import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { type CliIo, main } from "../../src/cli/main.js";
import type { NamedFile } from "../../src/cli/named-files.js";
import { printNamed } from "../../src/cli/named-print.js";
import { type EndedNamed, type EndedWait, waitText } from "../../src/cli/status-wait-lines.js";
import { markSpawn } from "../../src/core/daemon/start-mark.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { readLiveHeader } from "../../src/core/delivery/liveness.js";
import { formatStatus } from "../../src/core/status/index.js";
import { LOCKED_TEXT, SPAWNED_TEXT } from "../../src/core/status/outstanding-text.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { A, NOW, ref, repoWith } from "../cli/status-wait-fixture.js";
import { ended, ISSUE_99, NINE, SYNCED } from "../cli/wait-again-fixture.js";

// Row 011-243 (gh-99): each named line with no verdict that the row changed, from the product's
// own printer, plain and `--json` (the snapshot on stdout, the lines on stderr), each as text and
// in a Claude Code hook's JSON, read by the evals: no selected file credited, no verdict, the
// revision the line names, and the work it waits for counted pending, or no daemon validating.

/** A file running in the vitest lane, as the worktree's own counts say too. */
const RUNNING = ended([A], "timeout", 4, {
  verdict: { byClass: { current: 0, pending: 1, stale: 0, unknown: 0 } },
  files: [
    {
      testFile: ref(A),
      state: "pending",
      pending: { kind: "running", lane: "vitest", since: null },
    },
  ] as NamedFile[],
  result: {
    testFileCounts: { current: 5, pending: 1, stale: 0, unknown: 0 },
    testFilesByPhase: { running: 1, queued: 0 },
  },
});

const cases: [string, EndedNamed, { daemon: boolean }][] = [
  ["#99: revision 7 not listed, the passes at 6", ISSUE_99, { daemon: true }],
  [
    "the daemon's pass not stored",
    ended(NINE.slice(0, 2), "timeout", 42, { sync: { state: "pending" } }),
    { daemon: true },
  ],
  [
    "the daemon's pass past the results",
    ended([A], "timeout", 4, { sync: SYNCED(5) }),
    { daemon: true },
  ],
  [
    "a snapshot whose pass is not stored",
    ended([A], "timeout", 4, { snapshot: true, sync: { state: "pending" } }),
    { daemon: true },
  ],
  ["a pending tier", RUNNING, { daemon: true }],
  [
    "no daemon",
    ended([A], "no-daemon", 4, {
      down: "stopped",
      result: { daemon: { state: "not-validating", since: NOW - 60_000 } as never },
    }),
    { daemon: false },
  ],
];

/** `printNamed`'s output for `wait`: stdout, and with `--json` the snapshot then the lines. */
async function printed(wait: EndedNamed, json: boolean) {
  let out = "";
  const io: CliIo = { stdout: (t) => (out += t), stderr: (t) => (out += t), env: {} };
  const code = await printNamed(Promise.resolve(wait), { json }, io, () => NOW);
  return { code, out };
}

const hook = (text: string) =>
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext: text },
  });

describe.each(cases)("a named wait with no verdict, %s (row 011-243)", (_, wait, { daemon }) => {
  describe.each([
    ["as text", (t: string) => t],
    ["in a Claude Code hook's JSON", hook],
  ] as const)("%s", (__, wrap) => {
    it.each([false, true])("with --json %s: no file credited, no verdict", async (json) => {
      const { code, out } = await printed(wait, json);
      expect(code).toBe(3);
      expect(out).toMatch(daemon ? /A later pass is not reported\./ : /once a daemon runs/);
      const step = squealEvidence(wrap(out), "pull");
      expect(step).toMatchObject({ files: [], verdict: "unknown", daemon });
      expect(step).not.toHaveProperty("selected");
      if (daemon) expect(step?.pending).toBeGreaterThan(0);
      // The text names the wait's revision first; `--json`'s lines name none of their own.
      if (!json) expect(step?.revision).toBe(wait.result.revision);
    });
  });
});

describe("a snapshot whose daemon did not answer its sync, the worktree clear (row 011-243)", () => {
  // A misread before this row: `squealEvidence` read it as pending 0 and `pass`, while it exits 3.
  const unanswered = ended([A], "timeout", 4, { snapshot: true, sync: { state: "unsupported" } });
  const old =
    "Revision: 4\nSelected: src/a.test.ts\nNamed test files have no verdict: results are as of revision 4; the daemon did not answer its sync, so they may not hold the latest edits. Worktree: known failures 0; 6 test files current";

  it.each([false, true])("with --json %s reads as pending, no verdict", async (json) => {
    const { code, out } = await printed(unanswered, json);
    expect(code).toBe(3);
    expect(out).toContain("the daemon did not answer its sync");
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(out), "pull");
      expect(step).toMatchObject({ files: [], verdict: "unknown", daemon: true });
      expect(step?.pending).toBeGreaterThan(0);
    }
  });

  it("reads 0.1.333's words as pending, no verdict", () => {
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(old), "pull");
      expect(step).toMatchObject({ revision: 4, files: [], verdict: "unknown" });
      expect(step?.pending).toBeGreaterThan(0);
    }
  });
});

describe("a wait that went on while a daemon held the lock with no record (row 011-250)", () => {
  // Row 011-250 (gh-1): a daemon a hook spawned registers only once it opened the store; till
  // then the wait goes on and, at its deadline, says a daemon holds the lock. No daemon validates.
  const notValidating = { daemon: { state: "not-validating", since: NOW - 60_000 } as never };
  const named = ended([A], "timeout", 4, {
    lapsed: true,
    locked: true,
    verdict: { byClass: { current: 0, pending: 1, stale: 0, unknown: 0 } },
    files: [
      { testFile: ref(A), state: "pending", pending: { kind: "queued", lane: "vitest" } },
    ] as NamedFile[],
    result: {
      ...notValidating,
      testFileCounts: { current: 5, pending: 1, stale: 0, unknown: 0 },
      testFilesByPhase: { running: 0, queued: 1 },
    },
  });

  it.each([false, true])("named, with --json %s: no file credited, no verdict", async (json) => {
    const { code, out } = await printed(named, json);
    expect(code).toBe(3);
    expect(out).toContain(LOCKED_TEXT);
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(out), "pull");
      expect(step).toMatchObject({ files: [], verdict: "unknown", daemon: false });
      expect(step).not.toHaveProperty("selected");
    }
  });

  it("pathless: no daemon validating, nothing credited", () => {
    const out = waitText(
      {
        outcome: "timeout",
        waitedMs: 1_500,
        transitions: 0,
        locked: true,
        result: named.result,
      } as EndedWait,
      NOW as EpochMs,
    );
    expect(out).toContain(`${LOCKED_TEXT}, so the wait went on`);
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(out), "pull");
      expect(step).toMatchObject({ files: [], daemon: false });
    }
  });
});

describe("a daemon a hook started that holds no lock yet (row 011-251)", () => {
  // Row 011-251 (the coordinator, 2026-10-26): while only a hook's spawn mark is live, status, the
  // waits and the hooks' header say a daemon is starting, from the real store and marks. No
  // daemon validates, and nothing is credited.
  const saved = { ...process.env };
  let runtimeDir: string;
  beforeEach(() => {
    runtimeDir = mkdtempSync("/tmp/sq-");
    process.env.XDG_RUNTIME_DIR = runtimeDir;
  });
  afterEach(() => {
    rmSync(runtimeDir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  /** A worktree at revision 4 whose record a stop cleared, and a hook's spawn mark after its last heartbeat. */
  function spawned() {
    const { repo, store } = repoWith([A]);
    const id = repo.mainId as WorktreeId;
    store.worktrees.setDaemon(id, null);
    markSpawn(lockFileFor(repo.commonDir as AbsolutePath, id), (NOW - 500) as EpochMs, null);
    return { repo, store, id };
  }

  async function cli(argv: string[], cwd: string) {
    let out = "";
    const io: CliIo = {
      stdout: (t) => (out += t),
      stderr: (t) => (out += t),
      cwd,
      now: () => NOW,
      env: {},
    };
    const code = await main(argv, io);
    return { code, out };
  }

  const reads = (text: string, expected: Record<string, unknown>) => {
    for (const wrap of [(t: string) => t, hook]) {
      const step = squealEvidence(wrap(text), "pull");
      expect(step).toMatchObject({ files: [], daemon: false, ...expected });
      expect(step).not.toHaveProperty("selected");
    }
  };

  it.each([false, true])("a named wait, with --json %s", async (json) => {
    const { repo } = spawned();
    const argv = ["status", ...(json ? ["--json"] : []), "--wait", "1500", A];
    const { code, out } = await cli(argv, repo.main);
    expect(code).toBe(3);
    expect(out).toContain(`the deadline passed after 1.`);
    expect(out).toContain(SPAWNED_TEXT);
    reads(out, { verdict: "unknown" });
  });

  it("a pathless wait", async () => {
    const { repo } = spawned();
    const { code, out } = await cli(["status", "--wait", "1500"], repo.main);
    expect(code).toBe(0);
    expect(out).toContain(`${SPAWNED_TEXT}, so the wait went on`);
    reads(out, {});
  });

  it("plain status and a named status, through formatStatus", async () => {
    const { repo } = spawned();
    const snapshot = readStatus(repo.main as AbsolutePath, { now: () => NOW as EpochMs });
    if (!snapshot.available) throw new Error("status unavailable");
    expect(snapshot.daemon).toMatchObject({ state: "down", startMark: "spawn" });
    const text = formatStatus(snapshot, NOW as EpochMs);
    expect(text).toContain(`; ${SPAWNED_TEXT}\n`);
    reads(text, {});
    const named = await cli(["status", A], repo.main);
    expect(named.out).toContain(SPAWNED_TEXT);
    reads(named.out, { verdict: "unknown" });
  });

  it("the hooks' registration and change delivery, through formatRegistration and formatDelta", () => {
    const { store, id } = spawned();
    const header = readLiveHeader(store, id, NOW as EpochMs);
    expect(header.daemon).toMatchObject({ state: "down", startMark: "spawn" });
    const registration = formatRegistration({ header, knownFailures: [] } as never);
    const delta = formatDelta({ header, entries: [], slowTierChanged: true } as never);
    for (const text of [registration, delta]) {
      expect(text).toContain("A daemon is starting");
      reads(text, {});
    }
  });
});
