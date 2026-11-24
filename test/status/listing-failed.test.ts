import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendNote, readDaemonNotes } from "../../src/core/notes.js";
import { createDaemonRemote } from "../../src/core/runner-host/remote/daemon-lane.js";
import { REMOTE_SUMMARY_TOPIC } from "../../src/core/runner-host/remote/summary.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import {
  listingFailedOf,
  readRemoteSummary,
  unlistedText,
  writeRemoteSummary,
} from "../../src/core/status/remote-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { type DaemonNote, MAX_PERSISTED_NOTES } from "../../src/core/types/scheduler.js";
import type { DaemonLiveness } from "../../src/core/types/status.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { createRepo, openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";
import { appendRevisions, fakeRepo, seedStore } from "./helpers.js";

/*
 * Row 026-20 (lessons D1, vision principle 2): a first start whose listing
 * failed, such as a remote refused under `whenLost: "not-run"`, is never a
 * completed, empty checkpoint. Status says the listing failed and why,
 * and prints the remote's summary as `Remote:` (spec 026 D12.1), from a
 * row of its own that no other note evicts (review 0.1.623 B2).
 */

const ALIVE: DaemonLiveness = { state: "alive", lastHeartbeatAt: 0 };
const REFUSED =
  'remote command refused: degraded disk: 26 ms/sync, limit 10 ms; not planned here (whenLost "not-run")';
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const SUMMARY =
  "command cmd:lan-1: awake; background runs of vitest; planning remote; environment match-local";
const note0 = (text: string, revision: number | null, topic?: string): DaemonNote => ({
  at: 0,
  revision,
  text,
  ...(topic === undefined ? {} : { topic }),
});

describe("a first start whose listing failed (row 026-20)", SLOW, () => {
  it("completes no checkpoint and lists no file, where a healthy start completes its baseline", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      policy: RUN_MISSING,
      failing: ["testFiles"],
      allowErrors: true,
    });
    await h.scheduler.start();
    await h.quiet();
    const header = h.header();
    expect(header.testFilesListed).toBe(false);
    expect(header.fullSuite).toEqual({ atCurrentRevision: false, lastCompletedRevision: null });
    expect(store.checkpoints.lastCompletedFull(h.worktreeId)).toBeNull();

    const healthy = createRepo();
    const other = openRepoStore(healthy.commonDir);
    const ok = await openHarness(healthy.main, other, healthy.commonDir, { policy: RUN_MISSING });
    await ok.scheduler.start();
    await ok.quiet();
    expect(ok.header().fullSuite.atCurrentRevision).toBe(true);
  });
});

describe("status's listing failure and remote line (row 026-20)", () => {
  const unlisted = { revision: 0, testFilesListed: false };

  it("names the latest listing failure of the current revision while the live daemon listed nothing", () => {
    const notes = [
      note0("runner testFiles failed: older", 0),
      note0(`runner testFiles failed: ${REFUSED}`, 0),
    ];
    expect(listingFailedOf(notes, unlisted, ALIVE)).toEqual({ listingFailed: REFUSED });
    const text = unlistedText({ listingFailed: REFUSED }, "still starting");
    expect(text).toBe(
      `The daemon could not list this worktree's test files: ${REFUSED}. It lists them again at the next revision.`,
    );
    expect(unlistedText({}, "still starting")).toBe("still starting");
  });

  it("says nothing of a failure of another revision, a listed worktree or a stopped daemon", () => {
    const notes = [note0(`runner testFiles failed: ${REFUSED}`, 0)];
    expect(listingFailedOf(notes, { revision: 1, testFilesListed: false }, ALIVE)).toEqual({});
    expect(listingFailedOf(notes, { revision: 0, testFilesListed: true }, ALIVE)).toEqual({});
    expect(listingFailedOf(notes, unlisted, { state: "down", since: null })).toEqual({});
  });

  it("prints the remote's summary after more than MAX_PERSISTED_NOTES other notes, and none once cleared (review 0.1.623 B2)", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const wt = repo.mainId;
    store.worktrees.upsert({
      id: wt,
      root: repo.main,
      commonDir: repo.commonDir,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    appendRevisions(store, wt, 1, { head: null, dirty: true });
    // The daemon's routing (`Daemon.#run`): the summary to its own row, every other topic a note.
    const note = (text: string, topic?: string) =>
      topic === REMOTE_SUMMARY_TOPIC
        ? writeRemoteSummary(store, wt, text)
        : appendNote(store, wt, note0(text, 1, topic));
    const lastNote = (topic: string) =>
      topic === REMOTE_SUMMARY_TOPIC
        ? readRemoteSummary(store, wt)
        : readDaemonNotes(store, wt).findLast((n) => n.topic === topic)?.text;
    const churn = () => {
      for (let i = 0; i < MAX_PERSISTED_NOTES + 5; i++) note(`runner testFiles failed: churn ${i}`);
    };
    const plain = () => {
      const status = readStatus(repo.main);
      if (!status.available) throw new Error(status.message);
      return formatStatus(status, NOW).split("\n");
    };

    note(SUMMARY, REMOTE_SUMMARY_TOPIC);
    churn();
    expect(readDaemonNotes(store, wt)).toHaveLength(MAX_PERSISTED_NOTES);
    expect(plain()).toContain(`Remote: ${SUMMARY}`);

    // The lane removed from remote.json: the daemon's next start clears the line.
    const xdg = mkdtempSync(join(tmpdir(), "squeal-no-remote-"));
    const remote = createDaemonRemote({
      root: repo.main as AbsolutePath,
      commonDir: repo.commonDir as AbsolutePath,
      version: "0.0.0-test",
      launch: undefined,
      policy: () => DEFAULT_POLICY,
      note,
      lastNote,
      log: () => {},
      env: { XDG_CONFIG_HOME: xdg, XDG_STATE_HOME: xdg, HOME: xdg },
    });
    expect(remote).toBeNull();
    churn();
    expect(readRemoteSummary(store, wt)).toBeUndefined();
    expect(plain().filter((line) => line.startsWith("Remote:"))).toEqual([]);
  });
});
