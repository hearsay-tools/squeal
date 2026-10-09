import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { checkIdentity, readFlakyNotes } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { CheckId, Store } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  addWorktree,
  createRepo,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Spec 001 D6 as amended (task 001-170, decided by the human 2026-10-09): an
 * inherited fail is pending until the receiving worktree runs the file; its
 * local result replaces the shared row, so a local pass heals every worktree
 * under the key and leaves a flaky note; an inherited pass stands at once.
 * `test/flaky.test.ts` fails while a marker file outside the worktree
 * exists, which no key covers: the same key fails in one worktree and
 * passes in the other, as a failure caused by load does.
 */

const FLAKY = "test/flaky.test.ts";
const flips: CheckId = { kind: "test", project: "", testPath: FLAKY, fullName: "flips" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

/** A repository whose committed `test/flaky.test.ts` fails while the returned marker exists. */
function flakyRepo() {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-001-170-${randomUUID()}`);
  markers.push(marker);
  writeFileSync(
    join(repo.main, FLAKY),
    [
      'import { existsSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      "",
      'it("flips", () => {',
      `  expect(existsSync(${JSON.stringify(marker)})).toBe(false);`,
      "});",
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", FLAKY]);
  git(repo.main, ["commit", "-qm", "flaky"]);
  writeFileSync(marker, "");
  return { ...repo, marker };
}

/** A promise and its `resolve`, to hold a run while the test looks. */
function deferred() {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

function resultOf(store: Store, key: string | null) {
  return store.results.byKey(key, 0).find((r) => checkIdentity(r.check) === checkIdentity(flips));
}

/**
 * Worktree A runs and fails `flips`; worktree B starts with its first run
 * of the flaky file held, and `look` runs while it is held.
 */
async function inheritFail(options: HarnessOptions, slowFile = false) {
  const repo = flakyRepo();
  const other = addWorktree(repo.main, repo.dir, "other");
  const store = openRepoStore(repo.commonDir);
  const a = await openHarness(repo.main, store, repo.commonDir, options);
  await a.scheduler.start();
  await a.scheduler.idle();
  expect(a.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
  const told = await a.consumer();

  const b = await openHarness(other, store, repo.commonDir, options);
  const gate = deferred();
  let reached = () => {};
  const atRun = new Promise<void>((resolve) => {
    reached = resolve;
  });
  b.runner.beforeRun = async (files) => {
    if (!files.some((f) => f.path === FLAKY)) return;
    reached();
    await gate.held;
  };
  await b.scheduler.start();
  await atRun;
  expect(slowFile ? b.runsOf(FLAKY) : []).toEqual([]);
  return { repo, store, a, b, told, release: gate.release };
}

describe("an inherited failure stands only once the receiving worktree confirms it", SLOW, () => {
  it("holds A's fail in B as pending, runs it there, and a local pass heals A with a flaky note", async () => {
    const { repo, store, a, b, told, release } = await inheritFail({});
    const key = b.keyOf(FLAKY);
    expect(key).toBe(a.keyOf(FLAKY));

    // Held: no known state or transition in B, its file pending, `why` names the inherited fail.
    expect(b.sink.stateOf(flips)).toBeNull();
    expect(store.transitions.history(b.worktreeId, flips)).toEqual([]);
    expect(
      store.testFileKeys.list(b.worktreeId).find((r) => r.testFile.path === FLAKY),
    ).toMatchObject({ pending: "running" });
    const { delivery, consumer } = await b.consumer();
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
    const why = readWhy(b.root, `${FLAKY} > flips`);
    expect(why).toMatchObject({
      found: true,
      knownState: null,
      heldFailure: { outcome: "fail", provenance: { worktreeId: a.worktreeId } },
    });
    // The harness writes no worktree rows: A is named by its id.
    expect(formatWhy(why)).toContain(
      `  Inherited FAIL from removed worktree ${a.worktreeId} at ${resultOf(store, key)?.provenance.commit?.slice(0, 7)}, being confirmed`,
    );

    // B's run passes: the row is B's pass, A's state is the current pass, both carry the note.
    rmSync(repo.marker);
    release();
    await b.scheduler.idle();
    expect(b.runsOf(FLAKY)).toHaveLength(1);
    // Every other file of B inherited A's pass at once: B ran only the flaky file.
    expect(b.runner.runs.flatMap((run) => run.files.map((f) => f.path))).toEqual([FLAKY]);
    expect(resultOf(store, key)).toMatchObject({
      outcome: "pass",
      provenance: { worktreeId: b.worktreeId },
    });
    expect(b.sink.stateOf(flips)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(store.knownStates.get(a.worktreeId, flips)).toMatchObject({
      outcome: "pass",
      validity: "current",
      origin: { kind: "inherited", worktreeId: b.worktreeId },
    });
    expect(readFlakyNotes(store).get(checkIdentity(flips))).toMatchObject({
      key,
      from: "fail",
      to: "pass",
      fromWorktreeId: a.worktreeId,
      toWorktreeId: b.worktreeId,
    });
    expect(await delivery.onToolBoundary(consumer)).toBeNull();

    const healed = await told.delivery.onToolBoundary(told.consumer);
    expect(healed?.entries.map((e) => [e.check, e.kind])).toEqual([[flips, "fail-to-pass"]]);
    expect(formatDelta(healed ?? expect.fail("no delta"))).toContain(
      "Flaky: FAIL -> PASS under the same inputs",
    );
    expect(formatWhy(readWhy(a.root, `${FLAKY} > flips`))).toContain(
      "Flaky: FAIL -> PASS under the same inputs",
    );
  });

  it("delivers B's own local fail once and records no flaky note", async () => {
    const { store, a, b, release } = await inheritFail({});
    const { delivery, consumer } = await b.consumer();
    release();
    await b.scheduler.idle();

    const key = b.keyOf(FLAKY);
    expect(resultOf(store, key)).toMatchObject({
      outcome: "fail",
      provenance: { worktreeId: b.worktreeId },
    });
    expect(b.sink.stateOf(flips)).toMatchObject({
      outcome: "fail",
      validity: "current",
      origin: { kind: "own" },
    });
    const delta = await delivery.onToolBoundary(consumer);
    expect(delta?.entries.map((e) => [e.check, e.kind])).toEqual([[flips, "first-seen-fail"]]);
    expect(await delivery.onToolBoundary(consumer)).toBeNull();
    expect(readFlakyNotes(store).size).toBe(0);
    // A's own fail stands: it confirmed the key itself.
    expect(store.knownStates.get(a.worktreeId, flips)).toMatchObject({
      outcome: "fail",
      validity: "current",
    });
  });
});
