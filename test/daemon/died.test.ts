import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSnapshot, formatStatus } from "../../src/core/status/index.js";
import { type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  ping,
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
 * and is not called dead.
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
  const repo = suite.fixture({ "test/held.test.ts": heldTest(dir) });
  const spawned = suite.daemon(repo);
  await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
  await waitFor(() => existsSync(join(dir, "started")), 150_000, "the held file started").catch(
    (error: Error) => {
      throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
    },
  );
  return { repo, spawned };
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

        const later = Date.now() + LATER_MS;
        const snapshot = withStore(repo, (store) => buildSnapshot(store, repo.root, later));
        expect(snapshot.daemon).toMatchObject({
          state: "down",
          died: { runs: [expect.anything()] },
        });
        const runs = snapshot.daemon.state === "down" ? (snapshot.daemon.died?.runs ?? []) : [];
        const run = runs[0];
        expect(run?.testFiles.map((ref) => ref.path)).toContain("test/held.test.ts");
        const daemonLine = formatStatus(snapshot, later)
          .split("\n")
          .find((line) => line.startsWith("Daemon: "));
        expect(daemonLine).toMatch(
          new RegExp(
            `^Daemon: died without shutting down at about \\S+, during run ${run?.id} \\(revision \\d+\\) of .*test/held\\.test\\.ts.*\\. A SIGKILL, or a test that signals its own process group`,
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
            ` The last daemon died without shutting down at about \\S+, during run ${run?.id} \\(revision \\d+\\) of .*test/held\\.test\\.ts`,
          ),
        );
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
  },
);
