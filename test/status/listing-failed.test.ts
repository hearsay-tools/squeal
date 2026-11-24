import { describe, expect, it } from "vitest";
import { REMOTE_SUMMARY_TOPIC } from "../../src/core/runner-host/remote/summary.js";
import { listingFailedOf, remoteOf, unlistedText } from "../../src/core/status/remote-status.js";
import type { DaemonNote } from "../../src/core/types/scheduler.js";
import type { DaemonLiveness } from "../../src/core/types/status.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { SLOW } from "../scheduler/cleanup.js";
import { createRepo, openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";

/*
 * Row 026-20 (lessons D1, vision principle 2): a first start whose listing
 * failed, such as a remote refused under `whenLost: "not-run"`, is never a
 * completed, empty checkpoint. Status says the listing failed and why,
 * and prints the remote's summary as `Remote:` (spec 026 D12.1).
 */

const ALIVE: DaemonLiveness = { state: "alive", lastHeartbeatAt: 0 };
const REFUSED =
  'remote command refused: degraded disk: 26 ms/sync, limit 10 ms; not planned here (whenLost "not-run")';
const note = (text: string, revision: number | null, topic?: string): DaemonNote => ({
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
      note("runner testFiles failed: older", 0),
      note(`runner testFiles failed: ${REFUSED}`, 0),
    ];
    expect(listingFailedOf(notes, unlisted, ALIVE)).toEqual({ listingFailed: REFUSED });
    const text = unlistedText({ listingFailed: REFUSED }, "still starting");
    expect(text).toBe(
      `The daemon could not list this worktree's test files: ${REFUSED}. It lists them again at the next revision.`,
    );
    expect(unlistedText({}, "still starting")).toBe("still starting");
  });

  it("says nothing of a failure of another revision, a listed worktree or a stopped daemon", () => {
    const notes = [note(`runner testFiles failed: ${REFUSED}`, 0)];
    expect(listingFailedOf(notes, { revision: 1, testFilesListed: false }, ALIVE)).toEqual({});
    expect(listingFailedOf(notes, { revision: 0, testFilesListed: true }, ALIVE)).toEqual({});
    expect(listingFailedOf(notes, unlisted, { state: "down", since: null })).toEqual({});
  });

  it("reads the remote's latest summary line, and none once it is empty", () => {
    const line = "command cmd:lan-1: refused (degraded disk: 26 ms/sync, limit 10 ms); ...";
    expect(
      remoteOf([note("old", 0, REMOTE_SUMMARY_TOPIC), note(line, 0, REMOTE_SUMMARY_TOPIC)]),
    ).toEqual({
      remote: line,
    });
    expect(
      remoteOf([note(line, 0, REMOTE_SUMMARY_TOPIC), note("", 0, REMOTE_SUMMARY_TOPIC)]),
    ).toEqual({});
    expect(remoteOf([note(line, 0, "remote-lane")])).toEqual({});
  });
});
