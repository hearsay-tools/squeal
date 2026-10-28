// Throwaway research fixture: real CLI wait, queue and store; simulated daemon replacement.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { expect, it } from "vitest";
import { fileEntry } from "../../../../../../src/cli/named-file-lines.js";
import { namedCode, waitForNamed } from "../../../../../../src/cli/status-wait-paths.js";
import { promotedIds, publishPromotions } from "../../../../../../src/core/scheduler/promotions.js";
import { Priority, RunQueue } from "../../../../../../src/core/scheduler/queue.js";
import type { EpochMs, RevisionNumber } from "../../../../../../src/core/types/index.js";
import { A, B, NOW, ref, repoWith } from "../../../../../../test/cli/status-wait-fixture.js";

it("records promotion loss across a simulated successor and recovery on a new wait", async () => {
  const metadata = {
    at: new Date().toISOString(),
    load: loadavg(),
    cpus: cpus().length,
    node: process.version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    version: JSON.parse(readFileSync("package.json", "utf8")).version,
  };
  console.log(JSON.stringify({ metadata }));
  if (metadata.load[0] > metadata.cpus) {
    throw new Error("Live probe skipped: one-minute load exceeds CPU count");
  }
  const { repo, store } = repoWith([A, B]);
  let now = NOW;
  const makeQueue = () => {
    const queue = new RunQueue();
    queue.setPromotionClock(
      () => now,
      () => false,
      (live) => publishPromotions(store, repo.mainId, live, now as EpochMs),
    );
    for (const path of [A, B]) queue.add(ref(path), Priority.neverRun);
    return queue;
  };
  let queue = makeQueue();
  const order = () => queue.ordered().map((file) => file.path);
  const initial = order();
  const sent: { generation: number; paths: string[] }[] = [];
  let generation = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let before: string[] = [];
  let after: string[] = [];
  let oldVisible = -1;
  let successorVisible = -1;
  const options = (replace: boolean) => ({
    timeoutMs: 300,
    pollMs: 20,
    settleMs: 0,
    now: () => now,
    sync: () => ({
      current: () => ({
        state: "synced" as const,
        revision: 4 as RevisionNumber,
        incarnation: null,
      }),
      stop: () => {},
    }),
    promote: (_root: string, files: readonly ReturnType<typeof ref>[], withinMs: number) => {
      sent.push({ generation, paths: files.map((file) => file.path) });
      queue.promote(files, now + withinMs);
      if (!replace) return;
      before = order();
      oldVisible = promotedIds(store, repo.mainId, (NOW - 60_000) as EpochMs, now as EpochMs).size;
      // After the wait's read transaction: model a replacement before its deadline.
      timer = setTimeout(() => {
        generation = 2;
        now += 100;
        const row = store.worktrees.get(repo.mainId);
        if (!row?.daemon) throw new Error("missing fixture daemon");
        store.worktrees.upsert({
          ...row,
          daemon: {
            ...row.daemon,
            startedAt: now,
            heartbeatAt: now,
            token: "successor",
            squealVersion: "0.1.370",
          },
        });
        queue = makeQueue();
        after = order();
        successorVisible = promotedIds(store, repo.mainId, now as EpochMs, now as EpochMs).size;
      }, 40);
    },
  });
  try {
    const activeWait = await waitForNamed(repo.main, [B], options(true));
    expect(before).toEqual([B, A]);
    expect(after).toEqual([A, B]);
    expect(oldVisible).toBe(1);
    expect(successorVisible).toBe(0);
    expect(sent).toEqual([{ generation: 1, paths: [B] }]);
    expect(activeWait.outcome).toBe("timeout");
    if (activeWait.outcome === "unavailable") throw new Error("unavailable");
    const activeReason = fileEntry(activeWait.files[0], "squeal").reason;
    expect(activeReason).toBe("queued; no run is open and nothing recorded holds it");
    const activeSent = [...sent];
    const activeExit = namedCode(activeWait);
    expect(activeExit).toBe(3);
    const newWait = await waitForNamed(repo.main, [B], options(false));
    expect(sent).toEqual([
      { generation: 1, paths: [B] },
      { generation: 2, paths: [B] },
    ]);
    expect(order()).toEqual([B, A]);
    expect(queue.isPromoted(ref(B))).toBe(true);
    const evidence = {
      metadata,
      initial,
      before,
      after,
      oldVisible,
      successorVisible,
      activeWait: {
        outcome: activeWait.outcome,
        exit: activeExit,
        reason: activeReason,
        sent: activeSent,
      },
      sent,
      newWait: { outcome: newWait.outcome, order: order() },
      limit:
        "No test files run; no actual daemon or transport. Replacement and sync are simulated. New wait also times out because the fixture never drains.",
    };
    writeFileSync(
      "docs/specifications/011-core/research/probes/issue-116/evidence.json",
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(JSON.stringify(evidence));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
});
