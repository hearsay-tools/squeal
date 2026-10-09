import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { addWorktree, createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 13i, B1 (task 001-187): a heal that cannot apply in a
 * receiving worktree, because the run it heals from also failed another
 * check there, leaves that worktree's file held. Its ledger, not only its
 * states, learns it: the file is queued to be confirmed by a local run, and
 * no full-suite checkpoint completes over it. `test/pair.test.ts` holds two
 * checks that flip opposite ways with a marker outside the worktree, which
 * no key covers.
 */

const PAIR = "test/pair.test.ts";
const x: CheckId = { kind: "test", project: "", testPath: PAIR, fullName: "x" };
const y: CheckId = { kind: "test", project: "", testPath: PAIR, fullName: "y" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

/** A repository whose `x` passes and `y` fails while the marker is absent, the reverse while present. */
function pairRepo() {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-001-187-${randomUUID()}`);
  markers.push(marker);
  const at = JSON.stringify(marker);
  writeFileSync(
    join(repo.main, PAIR),
    [
      'import { existsSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      "",
      `it("x", () => expect(existsSync(${at})).toBe(false));`,
      `it("y", () => expect(existsSync(${at})).toBe(true));`,
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", PAIR]);
  git(repo.main, ["commit", "-qm", "pair"]);
  return { ...repo, marker };
}

/** A runs X PASS, Y FAIL; B, with the marker, holds Y, runs X FAIL, Y PASS, and Y's flip heals A. */
async function healMixed() {
  const repo = pairRepo();
  const other = addWorktree(repo.main, repo.dir, "other");
  const store = openRepoStore(repo.commonDir);
  // No re-runs: inheritance alone is under test.
  const a = await openHarness(repo.main, store, repo.commonDir, { rerunCap: 0 });
  await a.scheduler.start();
  await a.scheduler.idle();
  expect(a.sink.stateOf(x)).toMatchObject({ outcome: "pass", validity: "current" });
  expect(a.sink.stateOf(y)).toMatchObject({ outcome: "fail", validity: "current" });
  const told = await a.consumer();

  writeFileSync(repo.marker, "");
  const b = await openHarness(other, store, repo.commonDir, { rerunCap: 0 });
  await b.scheduler.start();
  await b.scheduler.idle();
  expect(b.runsOf(PAIR)).toHaveLength(1);
  expect(b.keyOf(PAIR)).toBe(a.keyOf(PAIR));
  expect(b.sink.stateOf(x)).toMatchObject({ outcome: "fail", origin: { kind: "own" } });
  return { store, a, b, told };
}

describe("a heal that leaves the receiving worktree's file held queues it there", SLOW, () => {
  it("is pending in A at once, and A's run --all runs it before its checkpoint completes", async () => {
    const { store, a, told } = await healMixed();

    // B's run failed X, which A never confirmed: A's file is held and pending, not stale.
    expect(a.runsOf(PAIR)).toHaveLength(1);
    expect(
      store.testFileKeys.list(a.worktreeId).find((r) => r.testFile.path === PAIR)?.pending,
    ).toBe("queued");
    expect(a.sink.stateOf(x)?.validity).toBe("pending");
    expect(a.sink.stateOf(y)?.validity).toBe("pending");

    const checkpoint = await a.scheduler.requestFullSuite();
    await a.scheduler.idle();
    expect(a.runsOf(PAIR)).toHaveLength(2);
    expect(store.checkpoints.get(checkpoint.id)?.testFiles.map((f) => f.path)).toContain(PAIR);
    expect(a.sink.stateOf(x)).toMatchObject({
      outcome: "fail",
      validity: "current",
      origin: { kind: "own" },
    });
    expect(a.sink.stateOf(y)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(a.header().counts).toMatchObject({ pending: 0, stale: 0 });
    expect(a.header().fullSuite.atCurrentRevision).toBe(true);
    const delta = await told.delivery.onToolBoundary(told.consumer);
    expect(delta?.entries.map((e) => [e.check, e.kind])).toEqual(
      expect.arrayContaining([
        [x, "pass-to-fail"],
        [y, "fail-to-pass"],
      ]),
    );
    expect(delta?.entries).toHaveLength(2);
  });

  it("is confirmed by A's next reconciliation pass without a request", async () => {
    const { a } = await healMixed();
    await a.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await a.scheduler.idle();
    expect(a.runsOf(PAIR)).toHaveLength(2);
    expect(a.sink.stateOf(x)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(a.sink.stateOf(y)).toMatchObject({ outcome: "pass", validity: "current" });
  });
});
