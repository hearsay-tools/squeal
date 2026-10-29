import { expect, it } from "vitest";
import { holdCommand, HOLD_WAIT_MS } from "../../../../../../src/cli/hold.js";
import { CommandHold } from "../../../../../../src/core/scheduler/command-hold.js";
import { readCommandHolds } from "../../../../../../src/core/scheduler/hold-rows.js";
import type { DaemonResponse } from "../../../../../../src/core/types/index.js";
import { fakeRepo, seedStore } from "../../../../../../test/status/helpers.js";

// Real store and child processes; daemon responses are deliberately synthetic.
it("a 1s hold expires while its foreground command is still alive", async () => {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const notes: string[] = [];
  const held = new CommandHold({
    store, worktreeId: repo.mainId, now: Date.now,
    note: (s) => notes.push(s), merging: () => false, due: () => held.check(),
  });
  let exited = false;
  let text = "";
  const running = holdCommand(
    ["--max", "1s", "--", process.execPath, "-e", "setTimeout(() => process.exit(7), 2200)"],
    { cwd: repo.main, stdout: () => {}, stderr: (s) => { text += s; } },
    { ask: async (_root, request) => {
      if (request.type === "hold") {
        held.check();
        return { schemaVersion: 1, ok: true, type: "hold", requestId: "probe", settled: true, holding: true, error: null } as DaemonResponse;
      }
      return { schemaVersion: 1, ok: true, type: "resume" } as DaemonResponse;
    } },
  ).then((code) => { exited = true; return code; });
  try {
    await expect.poll(() => readCommandHolds(store, repo.mainId)[0]?.child, { timeout: 2000 }).toBeTruthy();
    await expect.poll(() => held.holding, { timeout: 2000 }).toBe(false);
    expect(exited).toBe(false);
    const beforeExit = { holding: held.holding, exited, entries: readCommandHolds(store, repo.mainId).length };
    const code = await running;
    expect(code).toBe(7);
    expect(notes.some((s) => s.includes("passed its 1 s bound"))).toBe(true);
    console.log(JSON.stringify({ probe: "hold-expiry", beforeExit, code, note: "passed its 1 s bound; validating again" }));
  } finally {
    held.close();
    await running;
  }
});

it("starts a command after 3s even if cancellation never settles", async () => {
  const repo = fakeRepo();
  const store = seedStore(repo);
  let text = "";
  let polls = 0;
  const start = performance.now();
  const code = await holdCommand(
    ["--max", "10s", "--", process.execPath, "-e", "process.exit(0)"],
    { cwd: repo.main, stdout: () => {}, stderr: (s) => { text += s; } },
    { ask: async (_root, request) => {
      if (request.type === "hold" || request.type === "hold-status") {
        polls++;
        return { schemaVersion: 1, ok: true, type: "hold", requestId: "never", settled: false, holding: true, error: null } as DaemonResponse;
      }
      return { schemaVersion: 1, ok: true, type: "resume" } as DaemonResponse;
    } },
  );
  const elapsedMs = Math.round(performance.now() - start);
  expect(code).toBe(0);
  expect(elapsedMs).toBeGreaterThanOrEqual(HOLD_WAIT_MS);
  expect(polls).toBeGreaterThan(1);
  expect(readCommandHolds(store, repo.mainId)).toEqual([]);
  console.log(JSON.stringify({ probe: "unsettled-cancel", code, elapsedMs, cancellationSettled: false, printedUnsettledWarning: text.includes("tiers run on") }));
});
