import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { checkIdentity, readFlakyNotes } from "../../src/core/state/index.js";
import type { CheckId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { createRepo, type HarnessOptions, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 001 D6 as amended (task 001-171, decided by the human 2026-10-09): a
 * worktree's own new failure is reported at once, then its file is re-run
 * once in the next tier; a pass is reported `FAIL -> PASS` with the flaky
 * note, a fail again is no news, and no key is re-run twice.
 * `test/flaky.test.ts` fails while a marker outside the worktree exists,
 * which no key covers; with `once` its failing run removes the marker.
 */

const FLAKY = "test/flaky.test.ts";
const flips: CheckId = { kind: "test", project: "", testPath: FLAKY, fullName: "flips" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

function flakyRepo(once: boolean) {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-001-171-${randomUUID()}`);
  markers.push(marker);
  const at = JSON.stringify(marker);
  writeFileSync(
    join(repo.main, FLAKY),
    [
      'import { existsSync, rmSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      "",
      'it("flips", () => {',
      `  const failing = existsSync(${at});`,
      ...(once ? [`  rmSync(${at}, { force: true });`] : []),
      "  expect(failing).toBe(false);",
      "});",
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", FLAKY]);
  git(repo.main, ["commit", "-qm", "flaky"]);
  writeFileSync(marker, "");
  return repo;
}

/**
 * Starts a worktree on the flaky repository with its first run of the flaky
 * file held until a consumer is registered, so its failure is delivered as
 * news; `holdRerun` holds the second run of that file too.
 */
async function failFirst(once: boolean, options: HarnessOptions = {}) {
  const repo = flakyRepo(once);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, options);
  const gates: (() => void)[] = [];
  const reached: (() => void)[] = [];
  const atRun = [0, 1].map((i) => new Promise<void>((resolve) => (reached[i] = resolve)));
  const held = [0, 1].map((i) => new Promise<void>((resolve) => (gates[i] = resolve)));
  let seen = 0;
  h.runner.beforeRun = async (files) => {
    if (!files.some((f) => f.path === FLAKY)) return;
    const i = seen++;
    reached[i]?.();
    await held[i];
  };
  await h.scheduler.start();
  await atRun[0];
  const told = await h.consumer();
  gates[0]?.();
  return {
    store,
    h,
    told,
    atRerun: atRun[1] ?? expect.fail("no gate"),
    releaseRerun: () => gates[1]?.(),
  };
}

describe("a new failure is re-run once before it is trusted", SLOW, () => {
  it("reports a failure at once, re-runs it, and a pass is FAIL -> PASS with the flaky note", async () => {
    const { store, h, told, atRerun, releaseRerun } = await failFirst(true);
    const { delivery, consumer } = told;

    // Reported before the re-run ends.
    await atRerun;
    const failed = await delivery.onToolBoundary(consumer);
    expect(failed?.entries.map((e) => [e.check, e.kind])).toEqual([[flips, "first-seen-fail"]]);

    releaseRerun();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    const key = h.keyOf(FLAKY);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readFlakyNotes(store).get(checkIdentity(flips))).toMatchObject({
      key,
      from: "fail",
      to: "pass",
    });
    const healed = await delivery.onToolBoundary(consumer);
    expect(healed?.entries.map((e) => [e.check, e.kind])).toEqual([[flips, "fail-to-pass"]]);
    expect(formatDelta(healed ?? expect.fail("no delta"))).toContain(
      "Flaky: FAIL -> PASS under the same inputs",
    );
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
  });

  it("re-runs a file failing twice exactly once, reports one FAIL, and never re-runs the key again", async () => {
    const { store, h, told, releaseRerun } = await failFirst(false);
    const { delivery, consumer } = told;
    releaseRerun();
    await h.scheduler.idle();

    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(store.transitions.history(h.worktreeId, flips).map((t) => t.kind)).toEqual([
      "first-seen-fail",
    ]);
    const delta = await delivery.onToolBoundary(consumer);
    expect(delta?.entries.map((e) => [e.check, e.kind])).toEqual([[flips, "first-seen-fail"]]);
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
    expect(readFlakyNotes(store).size).toBe(0);

    // `run --all` finds the key current; a forced one runs it once and re-runs nothing.
    await h.scheduler.requestFullSuite();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    await h.scheduler.requestFullSuite({ force: true });
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(3);
    expect(store.transitions.history(h.worktreeId, flips)).toHaveLength(1);
  });

  it("never re-runs a test kept red across an edit: fail -> fail is no new failure", async () => {
    const { h, releaseRerun } = await failFirst(false);
    releaseRerun();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(2);

    const before = h.keyOf(FLAKY);
    h.write(FLAKY, `${readFileSync(join(h.root, FLAKY), "utf8")}// still red\n`);
    await h.batch(FLAKY);
    await h.scheduler.idle();
    expect(h.keyOf(FLAKY)).not.toBe(before);
    expect(h.runsOf(FLAKY)).toHaveLength(3);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
  });

  it("re-runs none of a tier's new failures above the cap, and says why", async () => {
    const { store, h } = await failFirst(true, { rerunCap: 0 });
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(1);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(readDaemonNotes(store, h.worktreeId).map((n) => n.text)).toContainEqual(
      expect.stringContaining(
        "1 test file failed anew in one tier, above the re-run cap of 0 per tier",
      ),
    );
  });
});
