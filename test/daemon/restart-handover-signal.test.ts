import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Task 011-65 (gh-50 symptom 1, `research/issue-50.md` finding 1), spec 011
 * C4 "Explicit checkpoints" as amended 2026-10-20 (row 011-30, Q3 (a), task
 * 011-33): a daemon's start queues again what its predecessor left queued or
 * running, whatever `baseline.onStart` says. `restart-handover.test.ts`
 * closes by `stop`, which cancels the tier in flight. A signal and a
 * `sessions-gone` exit close without a cancel: the tier in flight finishes
 * and stores, and the rows still `queued` are the ones `handover` reads.
 * `probes/issue-50/probe.sh graceful` is the scenario: six held files that
 * import one module, tiers of two, the module edited with the hold on.
 */

const suite = daemonSuite();
const SHARED = "src/held.ts";
const HELD = [1, 2, 3, 4, 5, 6].map((i) => `test/h${i}.test.ts`);
const SIGNAL_NOTE = /^daemon stopped: signal$/;
const GONE_NOTE = /daemon stopped: no session registered for 3 s after its last one ended/;

/** Appends its path to `started` on each run, then sleeps while `hold` exists. */
function heldTest(dir: string, path: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { appendFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
import { held } from "../src/held";
it("holds while the flag exists", async () => {
  appendFileSync(${at("started")}, ${JSON.stringify(`${path}\n`)});
  const deadline = Date.now() + 150_000;
  while (existsSync(${at("hold")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("hold")})).toBe(false);
  expect(held).toBeGreaterThan(0);
}, 170_000);
`;
}

/** What closes the daemon, and the note its shutdown writes first. */
interface Close {
  /** Before the baseline: what the close needs in place, such as a session. */
  readonly before?: (repo: FixtureRepo) => Promise<void>;
  readonly close: (repo: FixtureRepo, daemon: SpawnedProcess) => Promise<void>;
  readonly note: RegExp;
}

/** Each held file's `pending` as its row has it. */
function pendingOf(repo: FixtureRepo): Map<string, "queued" | "running" | null> {
  return withStore(
    repo,
    (store) =>
      new Map(
        store.testFileKeys
          .list(repo.worktreeId)
          .filter((row) => HELD.includes(row.testFile.path))
          .map((row) => [row.testFile.path, row.pending]),
      ),
  );
}

/** The held files with a current pass. */
function passing(repo: FixtureRepo): string[] {
  const states = withStore(repo, (store) => store.knownStates.list(repo.worktreeId));
  return HELD.filter((path) => {
    const own = states.filter((s) => s.check.testPath === path);
    return own.length > 0 && own.every((s) => s.validity === "current" && s.outcome === "pass");
  });
}

async function handsOver({ before, close, note }: Close): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "sq-011-65-"));
  const flag = join(dir, "hold");
  const startedPath = join(dir, "started");
  suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
  const repo = suite.fixture({
    "squeal.config.json": `${JSON.stringify({
      baseline: { onStart: "lookup-only" },
      runner: { tierSize: 2 },
    })}\n`,
    [SHARED]: "export const held = 1;\n",
    ...Object.fromEntries(HELD.map((path) => [path, heldTest(dir, path)])),
  });
  const squeal = (...args: string[]) =>
    spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
  const started = () =>
    existsSync(startedPath) ? readFileSync(startedPath, "utf8").split("\n").filter(Boolean) : [];

  const daemon = suite.daemon(repo);
  await waitReady(repo, daemon);
  await before?.(repo);
  expect((await squeal("run", "--all", "--wait").exited).code).toBe(0);
  expect(new Set(started())).toEqual(new Set(HELD));
  // The hold on, then the edit: its first tier holds two files, the rest wait queued.
  writeFileSync(flag, "");
  rmSync(startedPath);
  writeFileSync(join(repo.root, SHARED), "export const held = 2;\n");
  const atClose = await waitFor(
    () => {
      const rows = [...pendingOf(repo)];
      const running = rows.filter(([, p]) => p === "running").map(([path]) => path);
      const queued = rows.filter(([, p]) => p === "queued").map(([path]) => path);
      return started().length > 0 && running.length > 0 && queued.length > 0
        ? { running, queued }
        : null;
    },
    120_000,
    "the edit's first tier running, held, with files queued behind it",
  );

  await close(repo, daemon);
  await waitFor(() => readNotes(repo).some((n) => note.test(n)), 30_000, "the shutdown's note");
  rmSync(flag);
  expect(await daemon.exited, diagnose(repo, daemon)).toEqual({ code: 0, signal: null });
  // No cancel: the tier in flight stored, and the queued rows stay as they were.
  expect(passing(repo)).toEqual(expect.arrayContaining(atClose.running));
  const left = pendingOf(repo);
  expect(atClose.queued.map((path) => left.get(path))).toEqual(atClose.queued.map(() => "queued"));

  rmSync(startedPath, { force: true });
  expect(await squeal("start").exited).toEqual({ code: 0, signal: null });
  const wait = squeal("status", "--wait", "60000", ...HELD);
  expect((await wait.exited).code, wait.stdout()).toBe(0);
  expect(wait.stdout()).toMatch(
    /Named test files at revision \d+: no known failures; 6 test files, each with a current result/,
  );
  // The successor ran what was queued at the close, once each; its lookup found the rest.
  expect(started().sort()).toEqual([...atClose.queued].sort());
  expect(passing(repo)).toEqual(HELD);
}

/** The session the departure waits for: hooks run in this process, as `departure.test.ts` does. */
function session(repo: FixtureRepo): HookDeps {
  return {
    env: repo.env,
    ensureDaemon: async () => "alive",
    harnessProcess: () => findHarnessProcess({ ppid: process.pid }),
  };
}

describe.runIf(process.platform === "linux")(
  "a signal or sessions-gone close, then a start under lookup-only, hands the queued work over (task 011-65)",
  SLOW,
  () => {
    it("SIGTERM to the daemon: its tier in flight stores, and the successor runs what was queued", async () => {
      await handsOver({
        close: async (_repo, daemon) => {
          daemon.child.kill("SIGTERM");
        },
        note: SIGNAL_NOTE,
      });
    });

    it("the last session's end (sessions-gone): its tier in flight stores, and the successor runs what was queued", async () => {
      await handsOver({
        before: async (repo) => {
          const input = recorded("session-start", repo.root, {
            session_id: "s1",
            source: "startup",
          });
          await runHook("session-start", input, session(repo));
        },
        close: async (repo) => {
          const input = recorded("session-end", repo.root, { session_id: "s1" });
          await runHook("session-end", input, session(repo));
        },
        note: GONE_NOTE,
      });
    });
  },
);
