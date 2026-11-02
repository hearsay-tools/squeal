// Throwaway probe for research/stop-wait.md, question 1. Not a product test.
// Drives the real Stop entries (src at the commit named in stop-wait.md) on the
// fixture of test/harness/stop-slow-helpers.ts and prints what each case does.
import { expect, it } from "vitest";
import { runHook } from "../../../../../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../../../../../src/harness/codex/index.js";
import { slowFilesNotCurrent } from "../../../../../../src/core/state/index.js";
import { slowFiles } from "../../../../../../src/core/slow/index.js";
import { readPolicy } from "../../../../../../src/core/daemon/policy.js";
import { codexRecorded } from "../../../../../../test/harness/codex/helpers.js";
import { recorded, type SquealRepo } from "../../../../../../test/harness/helpers.js";
import {
  decision,
  deps,
  HARNESSES,
  markStopWait,
  repo,
  slowKey,
  stopBoth,
  turnOf,
} from "../../../../../../test/harness/stop-slow-helpers.js";

const open = (r: SquealRepo) =>
  slowFilesNotCurrent(
    r.store.knownStates.list(r.worktreeId),
    r.store.testFileKeys.list(r.worktreeId),
    slowFiles(readPolicy(r.root), readPolicy(r.root).nodeTest),
  ).map((f) => f.path);

const log = (name: string, value: unknown) => console.log(`CASE ${name}: ${JSON.stringify(value)}`);

for (const harness of HARNESSES) {
  it(`${harness.name} A: bound reached, then the next Stop (stop_hook_active) ends the turn`, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    const first = await stopBoth(harness, r);
    const second = await stopBoth.call(null, { ...harness, stop: (x) => harness.stop(x, { stop_hook_active: true }), stopSlow: (x) => harness.stopSlow(x, { stop_hook_active: true }) }, r);
    log(`${harness.name} A`, { first: [first.quick.decision ?? null, first.waiting.decision ?? null, Math.round(first.ms)], second: [second.quick.decision ?? null, second.waiting.decision ?? null, Math.round(second.ms)], turn: turnOf(r), notCurrent: open(r) });
    expect(first.waiting.decision).toBe("block");
    expect(second.quick).toEqual({});
    expect(second.waiting).toEqual({});
    expect(open(r)).toHaveLength(1);
  });

  it(`${harness.name} B: the 2 s entry speaks news, so the waiting entry stays silent; the next Stop ends the turn`, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    r.apply(r.fail());
    slowKey(r, "queued");
    const first = await stopBoth(harness, r);
    const active = { ...harness, stop: (x: SquealRepo) => harness.stop(x, { stop_hook_active: true }), stopSlow: (x: SquealRepo) => harness.stopSlow(x, { stop_hook_active: true }) };
    const second = await stopBoth(active, r);
    log(`${harness.name} B`, { firstQuick: Object.keys(first.quick), firstWaiting: first.waiting.decision ?? null, firstMs: Math.round(first.ms), second: [second.quick.decision ?? null, second.waiting.decision ?? null], turn: turnOf(r), notCurrent: open(r) });
    expect(first.waiting).toEqual({});
    expect(second.waiting).toEqual({});
    expect(open(r)).toHaveLength(1);
  });

  it(`${harness.name} C: a slow file not run and not queued is waited for to the bound`, async () => {
    const r = await repo(harness, { requireSlowSuite: true, slowWaitMs: 400 });
    slowKey(r, null);
    const first = await stopBoth(harness, r);
    log(`${harness.name} C`, { quick: first.quick.decision ?? null, waiting: first.waiting.decision ?? null, ms: Math.round(first.ms), reason: first.waiting.reason?.split("\n")[0], notCurrent: open(r) });
    expect(first.waiting.decision).toBe("block");
    expect(first.ms).toBeGreaterThanOrEqual(400);
  });
}

it("D: a SubagentStop under requireSlowSuite, both harnesses", async () => {
  const [cch, cxh] = HARNESSES;
  if (cch === undefined || cxh === undefined) throw new Error("no harness");
  const r = await repo(cch, { requireSlowSuite: true });
  await runHook("session-start", recorded("subagent-start", r.root), deps);
  slowKey(r, "queued");
  const cc = decision(await runHook("stop", recorded("subagent-stop", r.root), deps));
  const r2 = await repo(cxh, { requireSlowSuite: true });
  await runCodexHook("subagent-start", codexRecorded("exec", "subagent-start", r2.root), deps);
  slowKey(r2, "queued");
  const cx = decision(await runCodexHook("subagent-stop", codexRecorded("exec", "subagent-stop", r2.root), deps));
  log("D", { claudeCode: cc.decision ?? null, codex: cx.decision ?? null, ccReason: cc.reason?.split("\n")[0] ?? null, notCurrent: [open(r), open(r2)] });
});

void markStopWait;
