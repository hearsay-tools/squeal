import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askDaemon } from "../../src/cli/daemon-access.js";
import { checkpointMetaKey, parseCheckpointProgress } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { findHarnessProcess } from "../../src/harness/shared/harness-process.js";
import { recorded } from "../harness/helpers.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  waitFor,
  withStore,
} from "./helpers.js";

/*
 * Tasks 001-217 and 001-219 against a real daemon: a `run --all` requested
 * while the baseline runs joins it, and when the last session ends with that
 * checkpoint open, the daemon runs it to the end before it exits. The one
 * held test file waits for the test's flag.
 */

const suite = daemonSuite();

const DRAIN_NOTE =
  /^the last session ended with a `run --all` checkpoint \(\d+ test files? left\) pending/;
const DRAINED_NOTE = /^daemon stopped: the work pending when its last session ended is done/;

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

async function hook(repo: FixtureRepo, event: "session-start" | "session-end", sessionId: string) {
  const fields = event === "session-start" ? { source: "startup" } : {};
  const payload = recorded(event, repo.root, { session_id: sessionId, ...fields });
  await runHook(event, payload, {
    env: repo.env,
    ensureDaemon: async () => "alive",
    harnessProcess: () => findHarnessProcess({ ppid: process.pid }),
  });
}

describe.runIf(process.platform === "linux")(
  "a run --all outlives the session that asked for it (tasks 001-217, 001-219)",
  SLOW,
  () => {
    it("joins the running baseline, and the daemon finishes it after the session ended", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sq-001-219-"));
      suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
      const release = () => writeFileSync(join(dir, "flag"), "");
      // A stop waits for the held tier: release it before the daemons stop, even on failure.
      try {
        const repo = suite.fixture({ "test/held.test.ts": heldTest(dir) });
        const spawned = suite.daemon(repo);
        await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
        await hook(repo, "session-start", "s1");
        await waitFor(
          () => existsSync(join(dir, "started")),
          150_000,
          "the held file started",
        ).catch((error: Error) => {
          throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
        });

        const asked = await askDaemon(repo.socketPath, { type: "run-all", force: false });
        expect(asked).toMatchObject({ ok: true, type: "run-all" });
        const id = await waitFor(
          async () => {
            if (asked === null || !asked.ok || asked.type !== "run-all") return null;
            const state = await askDaemon(repo.socketPath, {
              type: "run-all-status",
              requestId: asked.requestId,
            });
            return state?.ok && state.type === "run-all" ? (state.checkpoint?.id ?? null) : null;
          },
          30_000,
          "the checkpoint recorded",
        );
        const open = withStore(repo, (store) =>
          parseCheckpointProgress(store.meta.get(checkpointMetaKey(repo.worktreeId))),
        );
        // Joined: the baseline stays the open checkpoint, now explicit.
        expect(open).toMatchObject({ kind: "run-all" });
        expect(open?.id).not.toBe(id);
        const ends = () =>
          withStore(repo, (store) => ({
            request: store.checkpoints.get(id)?.end ?? null,
            baseline: store.checkpoints.get(open?.id ?? "")?.end ?? null,
          }));
        expect(ends()).toEqual({ request: null, baseline: null });

        await hook(repo, "session-end", "s1");
        await delay(5_000);
        expect(spawned.child.exitCode).toBeNull();
        expect(
          readNotes(repo).filter((n) => DRAIN_NOTE.test(n)),
          readNotes(repo).join("\n"),
        ).toHaveLength(1);

        release();
        const exit = await Promise.race([spawned.exited, delay(60_000).then(() => null)]);
        if (exit === null) throw new Error(`the daemon still runs\n${diagnose(repo, spawned)}`);
        expect(exit).toEqual({ code: 0, signal: null });
        // The request ended with the baseline it joined, both completed.
        expect(ends()).toEqual({ request: "completed", baseline: "completed" });
        expect(readNotes(repo).filter((n) => DRAINED_NOTE.test(n))).toHaveLength(1);
      } finally {
        release();
      }
    });
  },
);
