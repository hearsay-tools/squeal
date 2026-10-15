// Review 001-423, main run 38784562554: a probe, not a suite test. Copy it to test/daemon/ to run:
// it holds the store's write lock while a daemon starts and prints that its front desk answers
// ping while the worktree row has no daemon record yet.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { daemonSuite, ping, SLOW, waitFor, waitReady, withStore } from "./helpers.js";

const suite = daemonSuite();

describe("probe: a daemon answers ping before its record is written", SLOW, () => {
  it("answers ping while its registration waits for the store's write lock", async () => {
    const repo = suite.fixture();
    // An earlier daemon registers the worktree row, then leaves.
    const first = suite.daemon(repo);
    await waitReady(repo, first);
    first.child.kill("SIGTERM");
    await first.exited;
    const db = new DatabaseSync(storePaths(repo.commonDir).database);
    db.exec("BEGIN IMMEDIATE");
    const t0 = Date.now();
    const spawned = suite.daemon(repo);
    const answer = await waitFor(() => ping(repo.socketPath, 500), 30_000, "ping");
    const pingAt = Date.now() - t0;
    const read = new DatabaseSync(storePaths(repo.commonDir).database, { readOnly: true });
    const row = read.prepare("SELECT * FROM worktrees").all();
    read.close();
    await new Promise((done) => setTimeout(done, 1_000));
    db.exec("COMMIT");
    db.close();
    await waitReady(repo, spawned);
    const after = withStore(repo, (s) => s.worktrees.get(repo.worktreeId)?.daemon ?? null);
    console.log(JSON.stringify({ pingAt, answer: answer !== null, rowsWhileLocked: row, recordAfter: after !== null }));
    expect(answer).not.toBeNull();
  });
});
