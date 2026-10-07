import { describe, expect, it } from "vitest";
import { bootstrappedMetaKey } from "../../src/core/types/index.js";
import { daemonSuite, readNotes, SLOW, waitFor, waitReady, withStore } from "./helpers.js";

/*
 * Task 001-94, review wave 10b B2; task 001-96: the daemon records that its
 * start scan is done, as its own `startedAt`. A consumer registered after it
 * may be told "none of your changes" while that daemon lives; no hook waits
 * for it.
 */

const suite = daemonSuite();

describe("the bootstrap marker", SLOW, () => {
  it("is written after the start scan, with the daemon's startedAt", async () => {
    const repo = suite.fixture();
    const spawnedAt = Date.now();
    const spawned = suite.daemon(repo);
    const read = () =>
      readNotes(repo)[0]?.startsWith("(store") === true
        ? { startedAt: null, marker: null }
        : withStore(repo, (store) => ({
            startedAt: store.worktrees.get(repo.worktreeId)?.daemon?.startedAt ?? null,
            marker: store.meta.get(bootstrappedMetaKey(repo.worktreeId)),
          }));
    const heartbeat = await waitFor(
      () => (read().startedAt === null ? null : Date.now()),
      60_000,
      "a heartbeat",
    );
    const scanned = await waitFor(
      () => (read().marker === null ? null : Date.now()),
      60_000,
      "the bootstrap marker",
    );
    await waitReady(repo, spawned);
    const { startedAt, marker } = read();
    expect(marker).toBe(String(startedAt));
    // How long after a spawn a registration can carry the marker, printed for the report.
    console.log(
      `bootstrap marker: heartbeat ${heartbeat - spawnedAt} ms, marker ${scanned - spawnedAt} ms after spawn`,
    );
  });
});
