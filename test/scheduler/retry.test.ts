import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  askRetry,
  cancelRetries,
  type HostLoad,
  type RetryReason,
  readRetries,
  readRunLoads,
} from "../../src/core/retry/index.js";
import { checkIdentity, readFlakyNotes } from "../../src/core/state/index.js";
import type { CheckId, Store } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  addWorktree,
  createRepo,
  type Harness,
  type HarnessOptions,
  openHarness,
  openRepoStore,
  SLOW,
} from "./helpers.js";

/*
 * Spec 001 D6 as amended (001-348, scope 001-368): the agent asks Squeal to
 * retry a failure caused outside its keyed inputs. `test/flaky.test.ts`
 * fails while a marker outside the worktree exists, which no key covers, as
 * a server nobody started or a timeout under load does.
 */

const FLAKY = "test/flaky.test.ts";
const flips: CheckId = { kind: "test", project: "", testPath: FLAKY, fullName: "flips" };
const REF = { project: "", path: FLAKY };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

function flakyRepo() {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-001-368-${randomUUID()}`);
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

/** A host load the test sets; 16 on 8 CPUs until it says otherwise. */
function loadKnob() {
  let load: HostLoad = { oneMinute: 16, cpus: 8 };
  return {
    read: () => load,
    set: (oneMinute: number) => {
      load = { oneMinute, cpus: 8 };
    },
  };
}

/** No 001-171 re-run: the failure stands after its first run, as one caused outside the code. */
const options = (load: ReturnType<typeof loadKnob>): HarnessOptions => ({
  rerunCap: 0,
  hostLoad: load.read,
});

async function failing(h: Harness) {
  await h.scheduler.start();
  await h.scheduler.idle();
  expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
  return h.keyOf(FLAKY) as string;
}

function ask(store: Store, h: Harness, session: string, reason: RetryReason) {
  return askRetry(store, {
    testFile: REF,
    key: h.keyOf(FLAKY) as string,
    session,
    reason,
    at: Date.now(),
    worktreeId: h.worktreeId,
  });
}

async function pass(h: Harness) {
  await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
  await h.scheduler.idle();
}

describe("squeal retry", SLOW, () => {
  it("runs an environment retry at once; its pass is FAIL -> PASS with the flaky note and ends the request", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    const key = await failing(h);
    expect(readRunLoads(store).get(h.runsOf(FLAKY)[0]?.options.runId as string)).toBe(2);
    rmSync(repo.marker);

    expect(ask(store, h, "s1", "environment").kind).toBe("queued");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readFlakyNotes(store).get(checkIdentity(flips))).toMatchObject({ key, from: "fail" });
    expect(readRetries(store)).toMatchObject([
      {
        session: "s1",
        reason: "environment",
        end: { outcome: "passed", worktreeId: h.worktreeId },
      },
    ]);
  });

  it("holds a load retry while the load is at or above the CPU count and runs it once it falls", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);
    rmSync(repo.marker);

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    await pass(h);
    load.set(8);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(1);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(readRetries(store)[0]).toMatchObject({ claim: null, end: null });

    load.set(7.5);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass" });
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
  });

  it("refuses a second request in a session at the key; another session gets its own retry", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(h);

    ask(store, h, "s1", "environment");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail" });
    expect(ask(store, h, "s1", "environment")).toMatchObject({
      kind: "spent",
      record: { end: { outcome: "failed" } },
    });

    rmSync(repo.marker);
    expect(ask(store, h, "s2", "environment").kind).toBe("queued");
    await h.scheduler.requestRetries();
    await h.scheduler.idle();
    expect(h.runsOf(FLAKY)).toHaveLength(3);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass" });
  });

  it("drops a pending retry that was cancelled", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    const key = await failing(h);

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    expect(cancelRetries(store, REF, key, h.worktreeId, Date.now())).toHaveLength(1);
    load.set(1);
    await pass(h);
    expect(h.runsOf(FLAKY)).toHaveLength(1);
    expect(readRetries(store)[0]?.end?.outcome).toBe("cancelled");
  });

  it("lapses when the file's key moves before it runs", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    const key = await failing(h);

    ask(store, h, "s1", "load");
    await h.scheduler.requestRetries();
    const path = join(repo.main, FLAKY);
    h.write(FLAKY, `${readFileSync(path, "utf8")}// edited\n`);
    await h.batch(FLAKY);
    await h.scheduler.idle();
    expect(h.keyOf(FLAKY)).not.toBe(key);
    load.set(1);
    await pass(h);
    // One ordinary run at the new key; the request at the old key stays pending for a worktree there.
    expect(h.runsOf(FLAKY)).toHaveLength(2);
    expect(readRetries(store)[0]).toMatchObject({ key, claim: null, end: null });
  });
});

describe("a pending retry outlives its daemon", SLOW, () => {
  it("is run by the next daemon of the worktree", async () => {
    const repo = flakyRepo();
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, options(load));
    await failing(first);
    ask(store, first, "s1", "load");
    await first.scheduler.requestRetries();
    await first.scheduler.close();
    rmSync(repo.marker);
    load.set(1);

    const second = await openHarness(repo.main, store, repo.commonDir, options(load));
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(second.runsOf(FLAKY)).toHaveLength(1);
    expect(second.sink.stateOf(flips)).toMatchObject({ outcome: "pass" });
    expect(readRetries(store)[0]?.end?.outcome).toBe("passed");
  });

  it("is run by another worktree's daemon at the key, and its pass heals the asking worktree", async () => {
    const repo = flakyRepo();
    const other = addWorktree(repo.main, repo.dir, "other");
    const load = loadKnob();
    load.set(1);
    const store = openRepoStore(repo.commonDir);
    const a = await openHarness(repo.main, store, repo.commonDir, options(load));
    const key = await failing(a);
    const b = await openHarness(other, store, repo.commonDir, options(load));
    // B confirms the failure with its own run (task 001-170).
    await failing(b);
    expect(b.keyOf(FLAKY)).toBe(key);
    // A's daemon is gone; B claims A's request at its next pass.
    await a.scheduler.close();
    ask(store, a, "s1", "environment");
    rmSync(repo.marker);
    await pass(b);
    expect(b.runsOf(FLAKY)).toHaveLength(2);
    expect(readRetries(store)[0]).toMatchObject({
      askedIn: a.worktreeId,
      end: { outcome: "passed", worktreeId: b.worktreeId },
    });
    expect(store.knownStates.get(a.worktreeId, flips)).toMatchObject({ outcome: "pass" });
  });
});
