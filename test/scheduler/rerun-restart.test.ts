import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkIdentity, readFlakyNotes } from "../../src/core/state/index.js";
import type { CheckId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 13i, S1 (task 001-187): a new failure's pending re-run and the
 * key it was re-run at survive a daemon restart. `test/flaky.test.ts` fails
 * while a marker outside the worktree exists, which no key covers.
 */

const FLAKY = "test/flaky.test.ts";
const flips: CheckId = { kind: "test", project: "", testPath: FLAKY, fullName: "flips" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

function flakyRepo() {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-001-187-${randomUUID()}`);
  markers.push(marker);
  writeFileSync(
    join(repo.main, FLAKY),
    [
      'import { existsSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      "",
      `it("flips", () => expect(existsSync(${JSON.stringify(marker)})).toBe(false));`,
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", FLAKY]);
  git(repo.main, ["commit", "-qm", "flaky"]);
  writeFileSync(marker, "");
  return { ...repo, marker };
}

/** A first daemon stores the new failure and exits before the re-run it queued starts. */
async function failThenExit() {
  const repo = flakyRepo();
  const store = openRepoStore(repo.commonDir);
  const first = await openHarness(repo.main, store, repo.commonDir);
  let reached = () => {};
  const atRun = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  first.runner.beforeRun = async (files) => {
    if (!files.some((f) => f.path === FLAKY)) return;
    reached();
    await held;
  };
  await first.scheduler.start();
  await atRun;
  // The tier in flight is recorded on close; no tier starts after it.
  const closed = first.scheduler.close();
  release();
  await closed;
  expect(first.runsOf(FLAKY)).toHaveLength(1);
  expect(first.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
  return { repo, store, first };
}

describe("a pending re-run survives a daemon restart", SLOW, () => {
  it("re-runs the failure once in the next daemon, and a pass is FAIL -> PASS with the note", async () => {
    const { repo, store, first } = await failThenExit();
    const key = first.keyOf(FLAKY);
    rmSync(repo.marker);

    const second = await openHarness(repo.main, store, repo.commonDir);
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(second.runsOf(FLAKY)).toHaveLength(1);
    expect(second.sink.stateOf(flips)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readFlakyNotes(store).get(checkIdentity(flips))).toMatchObject({
      key,
      from: "fail",
      to: "pass",
    });

    // The re-run is done and its key remembered: a third daemon runs nothing.
    await second.scheduler.close();
    const third = await openHarness(repo.main, store, repo.commonDir);
    await third.scheduler.start();
    await third.scheduler.idle();
    expect(third.runner.runs).toEqual([]);
  });

  it("drops the re-run when the file's key moved before it ran: the new key runs unforced", async () => {
    const { repo, store, first } = await failThenExit();
    const before = first.keyOf(FLAKY);
    const path = join(repo.main, FLAKY);
    writeFileSync(path, `${readFileSync(path, "utf8")}// edited\n`);

    const second = await openHarness(repo.main, store, repo.commonDir);
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(second.keyOf(FLAKY)).not.toBe(before);
    // One run at the new key; its fail is no new failure (it was failing), so no re-run.
    expect(second.runsOf(FLAKY)).toHaveLength(1);
    expect(second.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
  });
});
