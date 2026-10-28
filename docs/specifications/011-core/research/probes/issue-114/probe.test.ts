// Throwaway reproduction. Real CLI, scheduler, store and slow-slot locks; fake runner.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, loadavg, availableParallelism } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, onTestFinished } from "vitest";
import { retryCommand } from "../../../../../../src/cli/retry.js";
import { readRetries } from "../../../../../../src/core/retry/index.js";
import { acquireSlowSlot } from "../../../../../../src/core/slow/index.js";
import { readSlowActivity } from "../../../../../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/index.js";
import { claimRepo, fileName, side } from "../../../../../../test/scheduler/claims-fixture.js";
import { fakeDaemon, closeFakeDaemons } from "../../../../../../test/cli/fake-daemon.js";

it("receipt claims now while a slow retry waits for fast work and then the slot", async () => {
  const evidence: unknown[] = [];
  const record = (value: unknown) => { evidence.push(value); };
  const load = loadavg()[0];
  const cpus = availableParallelism();
  record({ event: "host", at: new Date().toISOString(), load, cpus, node: process.version });
  if (load > cpus) throw new Error("Live reproduction skipped: load exceeds CPU count");
  const slotDir = mkdtempSync(join(tmpdir(), "issue-114-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const slow = fileName(0), fast = fileName(1);
  const { main } = claimRepo(2, {}, 0);
  const h = side(main, {
    count: 2, rerunCap: 0,
    policy: {
      baseline: { onStart: "lookup-then-run-missing" },
      slow: { ...DEFAULT_POLICY.slow, include: [slow], quietMs: 0, maxParallel: 1 },
    },
    slow: { slotDir, recheckMs: 25, load: () => [0.5], cpus: () => 1 },
  });
  h.runner.failing.add(slow);
  await h.scheduler.start();
  await expect.poll(() => h.runner.ran(slow)).toBe(1);
  await h.scheduler.idle();
  expect(h.store.knownStates.list(h.worktreeId).find(s => s.check.kind === "test" && s.check.testPath === slow)?.outcome).toBe("fail");

  // A real lock in the private slot directory represents another daemon.
  const slot = acquireSlowSlot({ dir: slotDir, owner: { pid: process.pid, worktreeId: "other-probe-daemon" }, permits: 1 });
  expect(slot).not.toBeNull();
  onTestFinished(() => slot?.release());
  let releaseFast = () => {};
  const fastGate = new Promise<void>(resolve => { releaseFast = resolve; });
  onTestFinished(() => releaseFast());
  h.runner.during = files => files.some(f => f.path === fast) ? fastGate : undefined;
  writeFileSync(join(main, fast), "// changed fast input\n");
  await h.batch(fast);
  await expect.poll(() => h.runner.active).toBe(1);
  h.runner.failing.delete(slow); // External condition fixed; no slow keyed input changes.

  // The socket acknowledges notification. requestRetries below performs the real daemon action.
  const daemon = h.store.worktrees.get(h.worktreeId)!.daemon!;
  await fakeDaemon(daemon.socketPath, { ping: [{ ok: true, type: "ping", pid: process.pid,
    worktreeId: h.worktreeId, root: main, squealVersion: "0.0.0-test", phase: "ready", startedAt: Date.now() }] });
  onTestFinished(() => closeFakeDaemons());
  let stdout = "", stderr = "";
  const started = Date.now();
  const code = await retryCommand([slow, "--reason", "environment"], {
    cwd: main, env: { CLAUDE_CODE_SESSION_ID: "issue-114" },
    stdout: text => { stdout += text; }, stderr: text => { stderr += text; },
  });
  record({ event: "receipt", code, stdout, stderr });
  expect(code).toBe(0);
  expect(stdout).toContain("runs once more now");
  expect(stdout).not.toContain("No daemon took");
  await h.scheduler.requestRetries();
  const snapshot = (event: string) => {
    const retry = readRetries(h.store)[0];
    const failure = h.store.knownStates.list(h.worktreeId).find(s => s.check.kind === "test" && s.check.testPath === slow);
    const result = { event, elapsedMs: Date.now() - started, activity: readSlowActivity(h.store, h.worktreeId),
      fastActive: h.runner.active, phase: h.phase(slow), slowRuns: h.runner.ran(slow), retryEnd: retry?.end?.outcome ?? null,
      outcome: failure?.outcome, validity: failure?.validity };
    record(result);
    return result;
  };
  await expect.poll(() => h.phase(slow)).toBe("queued");
  await delay(150);
  expect(snapshot("fast-blocked")).toMatchObject({ fastActive: 1, phase: "queued", slowRuns: 1, retryEnd: null, outcome: "fail", validity: "current" });
  releaseFast();
  await expect.poll(() => readSlowActivity(h.store, h.worktreeId)).toEqual({ kind: "waiting", for: "slot" });
  await delay(150);
  expect(snapshot("slot-blocked")).toMatchObject({ phase: "queued", slowRuns: 1, retryEnd: null, outcome: "fail", validity: "current" });
  slot!.release();
  await expect.poll(() => readRetries(h.store)[0]?.end?.outcome).toBe("passed");
  expect(snapshot("released")).toMatchObject({ phase: null, slowRuns: 2, retryEnd: "passed", outcome: "pass", validity: "current" });
  writeFileSync(new URL("./evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
});
