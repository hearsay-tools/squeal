import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { appendNote } from "../../src/core/notes.js";
import { buildSnapshot, formatStatus } from "../../src/core/status/index.js";
import {
  type AbsolutePath,
  type DaemonRequest,
  daemonExitMetaKey,
  daemonIncarnation,
} from "../../src/core/types/index.js";
import { type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded } from "../harness/helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  waitFor,
  withStore,
} from "./helpers.js";

/*
 * Task 001-263 (`research/daemon-sigkill.md`): a daemon killed mid-tier, as
 * a hosted test's `kill(0, "SIGKILL")` kills it, writes no note and leaves
 * its record on a stale heartbeat. Status and the next hook say it died and
 * name the run in flight; a daemon that is only stopped still holds its lock
 * and is not called dead. Review wave-13af B1 (001-272): only the note its
 * own shutdown writes says it left, never an ordinary note before the kill.
 */

const suite = daemonSuite();
/** Past the daemon's heartbeat window (two 5 s intervals). */
const LATER_MS = 60_000;

function heldTest(dir: string): string {
  const at = (name: string) => JSON.stringify(join(dir, name));
  return `import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
it("holds until the flag", async () => {
  writeFileSync(${at("started")}, "");
  const deadline = Date.now() + 150_000;
  while (!existsSync(${at("flag")}) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  expect(existsSync(${at("flag")})).toBe(true);
}, 170_000);
`;
}

const context = (out: HookResult): string =>
  (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

/** A daemon serving `repo`, its baseline holding `test/held.test.ts` in a tier. */
async function heldDaemon(dir: string): Promise<{ repo: FixtureRepo; spawned: SpawnedProcess }> {
  const repo = suite.fixture({
    "test/held.test.ts": heldTest(dir),
    "squeal.config.json": runMissingConfig(),
  });
  const spawned = suite.daemon(repo);
  await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
  await waitFor(() => existsSync(join(dir, "started")), 150_000, "the held file started").catch(
    (error: Error) => {
      throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
    },
  );
  return { repo, spawned };
}

/** Status and the next hook, past the heartbeat window, say the daemon died during the held file's run. */
async function expectDeath(repo: FixtureRepo): Promise<void> {
  const later = Date.now() + LATER_MS;
  const snapshot = withStore(repo, (store) => buildSnapshot(store, repo.root, later));
  expect(snapshot.daemon).toMatchObject({
    state: "down",
    died: { runs: [expect.anything()] },
  });
  const runs = snapshot.daemon.state === "down" ? (snapshot.daemon.died?.runs ?? []) : [];
  const run = runs[0];
  expect(run?.testFiles.map((ref) => ref.path)).toContain("test/held.test.ts");
  const daemonLine = formatStatus(snapshot, later, "squeal", { full: true })
    .split("\n")
    .find((line) => line.startsWith("Daemon: "));
  // Row 011-29: the default text says it in its first outstanding group.
  expect(formatStatus(snapshot, later)).toMatch(
    new RegExp(
      `\n {2}no daemon has validated since \\S+; results are as of revision \\d+; it died without shutting down, during run ${run?.id} \\(revision \\d+\\) of .*test/held\\.test\\.ts.*; \`squeal start\` starts one\\. A SIGKILL, or a test that signals its own process group`,
    ),
  );
  expect(daemonLine).toMatch(
    new RegExp(
      `^Daemon: no daemon running since \\S+; it died without shutting down, during run ${run?.id} \\(revision \\d+\\) of .*test/held\\.test\\.ts.*\\. A SIGKILL, or a test that signals its own process group`,
    ),
  );

  // The next hook: a session starting while no daemon validates, none started.
  const out = await runHook(
    "session-start",
    recorded("session-start", repo.root, { session_id: "s1", source: "startup" }),
    {
      env: repo.env,
      ensureDaemon: async () => "unavailable",
      now: () => later,
      harnessProcess: () => null,
    },
  );
  expect(context(out)).toMatch(
    new RegExp(
      `; results are as of revision \\d+\\. The last daemon died without shutting down, during run ${run?.id} \\(revision \\d+\\) of .*test/held\\.test\\.ts`,
    ),
  );
}

describe.runIf(process.platform === "linux")(
  "a daemon that died without shutting down is named (task 001-263)",
  SLOW,
  () => {
    it("status and the next hook say it died, with the run in flight", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-001-263-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      try {
        const { repo, spawned } = await heldDaemon(dir);
        spawned.child.kill("SIGKILL");
        expect(await spawned.exited).toEqual({ code: null, signal: "SIGKILL" });

        await expectDeath(repo);
      } finally {
        writeFileSync(join(dir, "flag"), "");
      }
    });

    it("a stopped daemon still holds its lock and is not called dead", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-001-263-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      try {
        const { repo, spawned } = await heldDaemon(dir);
        spawned.child.kill("SIGSTOP");
        try {
          const later = Date.now() + LATER_MS;
          const snapshot = withStore(repo, (store) => buildSnapshot(store, repo.root, later));
          expect(snapshot.daemon.state).toBe("down");
          expect(snapshot.daemon).not.toHaveProperty("died");
        } finally {
          spawned.child.kill("SIGCONT");
        }
      } finally {
        writeFileSync(join(dir, "flag"), "");
      }
    });

    it("an ordinary note before the kill does not hide the death (wave-13af B1)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-001-272-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      try {
        const { repo, spawned } = await heldDaemon(dir);
        withStore(repo, (store) =>
          appendNote(store, repo.worktreeId, {
            at: Date.now(),
            revision: null,
            text: "watcher dropped events (probe); a full reconciliation follows",
          }),
        );
        spawned.child.kill("SIGKILL");
        expect(await spawned.exited).toEqual({ code: null, signal: "SIGKILL" });

        await expectDeath(repo);
      } finally {
        writeFileSync(join(dir, "flag"), "");
      }
    });

    it("another incarnation's shutdown mark does not hide the death (001-274)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-001-274-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      try {
        const { repo, spawned } = await heldDaemon(dir);
        withStore(repo, (store) => {
          const record = store.worktrees.get(repo.worktreeId)?.daemon;
          if (!record) throw new Error("no daemon registered");
          const other = daemonIncarnation({ ...record, token: "another" });
          store.meta.set(daemonExitMetaKey(repo.worktreeId), other);
        });
        spawned.child.kill("SIGKILL");
        expect(await spawned.exited).toEqual({ code: null, signal: "SIGKILL" });

        await expectDeath(repo);
      } finally {
        writeFileSync(join(dir, "flag"), "");
      }
    });

    /*
     * A shutdown waits for the tier in flight (D10): the held file keeps it
     * between its note and clearing the record, and a SIGKILL there leaves
     * both, its lock free and its heartbeat stale. It said it was leaving.
     */
    it.each<[string, DaemonRequest, string]>([
      ["a stop", { type: "stop" }, "daemon stopped: squeal stop"],
      ["a step-down", { type: "step-down", version: "999.0.0" }, "are newer than this daemon"],
    ])(
      "%s killed before it finished is not called dead (wave-13af B1)",
      async (_, request, said) => {
        const dir = mkdtempSync(join(tmpdir(), "sq-001-272-"));
        suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
        try {
          const { repo, spawned } = await heldDaemon(dir);
          await requestDaemon(repo.socketPath as AbsolutePath, request, 10_000);
          await waitFor(
            () => readNotes(repo).some((text) => text.includes(said)),
            30_000,
            "the shutdown's note",
          );
          spawned.child.kill("SIGKILL");
          expect(await spawned.exited).toEqual({ code: null, signal: "SIGKILL" });

          const later = Date.now() + LATER_MS;
          const snapshot = withStore(repo, (store) => {
            expect(store.worktrees.get(repo.worktreeId)?.daemon).not.toBeNull();
            return buildSnapshot(store, repo.root, later);
          });
          expect(snapshot.daemon.state).toBe("down");
          expect(snapshot.daemon).not.toHaveProperty("died");
        } finally {
          writeFileSync(join(dir, "flag"), "");
        }
      },
    );
  },
);
