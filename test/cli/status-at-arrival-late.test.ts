import { describe, expect, it } from "vitest";
import { askGreen, readGreen } from "../../src/cli/proof-green-run.js";
import { commonDirOf, type KeyedFile } from "../../src/core/commit/at-keys-checkout.js";
import { storedReason } from "../../src/core/daemon/at-asks.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import {
  type Arrival,
  arrival,
  LISTS,
  pending,
  resultsOf,
  rowOf,
  watched,
} from "./status-at-arrival-kit.js";
import { run } from "./status-at-kit.js";

/*
 * Review 0.1.612 B1 (rows 023-70, 023-76): the reviewer's gate ordering.
 * The caller's run starts while `test/fixtures/` holds only the commit's
 * tracked name, so its key is the commit's; `extra.log` appears from
 * outside the run after that (`arrival(…, true)`). The caller's run lists
 * two names and passes, and its pass lands at the commit's key. A key is
 * computed before the run and does not certify what the run listed, so the
 * commit side never reads that pass: a folder reader's result counts at
 * the commit only when the commit worktree wrote it (row 023-70's rule).
 * The call reads "not comparable", never the caller's pass. Without the
 * rule, the commit side read "pass -> pass, unchanged" and the proof read
 * the pass from the store.
 */

const REASON = storedReason("test/fixtures/");
const ASK = { commit: "", paths: [LISTS.path], run: { allMissing: false }, json: true };

/** The caller's pass is the one record at the key both daemons share. */
function sharedPass(arrived: Arrival): void {
  const { f, live } = arrived;
  const caller = resultsOf(f, live[0]);
  const commit = resultsOf(f, live[1]);
  expect(caller.key, "both keys hold the one tracked name").toBe(commit.key);
  const tests = commit.results.filter((r) => r.check.kind === "test");
  expect(tests.map((r) => [r.outcome, r.provenance.worktreeId])).toEqual([
    ["pass", live[0]?.worktreeId],
  ]);
}

describe("an ignored name written after both keys (review 0.1.612 B1)", {
  timeout: 240_000,
}, () => {
  it("reads not comparable in the --run call that waits, never the caller's pass", async () => {
    const arrived = await arrival(true, true);
    const { f, a } = arrived;
    const seen = { before: false };
    const out = await run(
      f,
      { ...ASK, commit: a, waitMs: 120_000 },
      { cacheRoot: f.cacheRoot, daemons: watched(arrived, seen, true) },
    );
    expect(seen.before, "the commit selected the file before any result was stored").toBe(true);
    const row = rowOf(out.out);
    expect(row?.now.state, out.err).toBe("pass");
    expect(row?.at).toEqual({ state: "not comparable", reason: REASON });
    expect(out.code).toBe(3);
    sharedPass(arrived);
  });

  it("reads not comparable in a --wait that joins the queued ask after the pass arrived", async () => {
    const arrived = await arrival(true, true);
    const { f, a, live } = arrived;
    const seen = { before: false };
    const daemons = watched(arrived, seen);
    const first = await run(
      f,
      { ...ASK, commit: a, waitMs: 20_000 },
      { cacheRoot: f.cacheRoot, daemons },
    );
    expect(seen.before).toBe(true);
    expect(rowOf(first.out)?.at.state).toBe("no result");
    arrived.open();
    await expect.poll(() => pending(f, live[0]), { timeout: 60_000 }).toBeNull();
    const joined = await run(
      f,
      { commit: a, paths: [LISTS.path], json: true, waitMs: 60_000 },
      { cacheRoot: f.cacheRoot, daemons },
    );
    expect(rowOf(joined.out)?.at, joined.err).toEqual({ state: "not comparable", reason: REASON });
    expect(joined.code).toBe(3);
    sharedPass(arrived);
  });

  it("reads unknown in the proof's green side, asked before the pass arrived", async () => {
    const arrived = await arrival(true, true);
    const { f, a, live, real } = arrived;
    const by = Date.now() + 120_000;
    // The commit daemon starts with the `status --at` call that stops at its short wait.
    const first = await run(
      f,
      { ...ASK, commit: a, waitMs: 5_000 },
      { cacheRoot: f.cacheRoot, daemons: real },
    );
    expect(rowOf(first.out)?.at.state, first.err).toBe("no result");
    const tree = live[1]?.root;
    if (tree === undefined) throw new Error("no commit daemon");
    const input = { daemons: real, root: f.root, tree, commonDir: commonDirOf(f.root), by, at: a };
    // `readGreen` reads each file by its ref at the daemon's live key.
    const toRun = [{ ref: LISTS } as unknown as KeyedFile];
    const asked = await askGreen(input, toRun, "proof-late");
    expect("own" in asked && asked.own.phase).toBe("queued");
    arrived.open();
    await expect.poll(() => pending(f, live[0]), { timeout: 60_000 }).toBeNull();
    const side = (await readGreen(input, asked, toRun, "proof-late")).get(testFileId(LISTS));
    expect(side).toMatchObject({ end: { end: "unknown", reason: REASON }, runs: 0 });
    sharedPass(arrived);
  });
});
