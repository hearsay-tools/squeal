import { describe, expect, it } from "vitest";
import { type SlotHarness, slotHarness, testPath } from "./slots-fixture.js";

/*
 * Task 011-21 slice 2, done-when 3 (`research/streaming-lanes.md` finding 1,
 * "Per-file overhead", and test 6), as task 011-99 measures it: a slot costs
 * a selection, a record, a pool acquisition and a `node` start, which a tier
 * pays once for all its files but the start. 300 node:test files that each
 * spin about 50 ms run a forced pass in slots, and the daemon's CPU per file
 * there is at most 5.5 times its CPU per file in one backlog tier of them; the
 * slots that end while a record gathers or holds the lock share its commit:
 * fewer sink commits than files. Each commit holds the thread 55 ms, the
 * least a sink call took on cezar's store. The CPU is the daemon's own
 * (`process.cpuUsage()`, the files run in their own processes), net of those
 * busy-waits, so a slower CPU moves both passes, and a busy host moves it far
 * less than their clocks: the wall-clock ratio this test bounded at 1.2
 * failed on main, alone and at 2 CPUs (1.21 to 1.26), and at slice 2's own
 * commit (1.40; 011-99). One harness alternates the two, tier first, and each
 * is its best of two rounds.
 */
const FILES = 300;
const APPLY_MS = 55;
const ROUNDS = 2;

async function forcedPass({ h, runs, applyCpuMs }: SlotHarness) {
  const before = { runs: runs.length, commits: h.sink.calls.length, applyCpuMs: applyCpuMs() };
  const cpu = process.cpuUsage();
  const started = performance.now();
  await h.scheduler.requestFullSuite({ force: true });
  await h.scheduler.idle();
  const ms = performance.now() - started;
  const used = process.cpuUsage(cpu);
  const cpuMs = ((used.user + used.system) / 1000 - (applyCpuMs() - before.applyCpuMs)) / FILES;
  const pass = runs.slice(before.runs);
  const commits = h.sink.calls
    .slice(before.commits)
    .filter((call) => call.method === "applyResults").length;
  return { ms, cpuMs, pass, commits };
}

describe("scheduler: a node:test backlog in one-file slots, per-file overhead (task 011-21 slice 2)", () => {
  it("3. runs 300 files of about 50 ms at most 5.5 times a tier's daemon CPU per file, with fewer commits than files", {
    timeout: 600_000,
  }, async () => {
    const files = Array.from({ length: FILES }, (_, i) => ({
      name: `o${String(i).padStart(3, "0")}`,
      sleepMs: 0,
      spinMs: 50,
    }));
    const harness = await slotHarness({
      files,
      hostSlots: 4,
      backlogTierSize: FILES,
      applyMs: APPLY_MS,
    });
    const { h } = harness;
    await h.scheduler.start();
    await h.scheduler.idle();
    const tiers: Awaited<ReturnType<typeof forcedPass>>[] = [];
    const slots: typeof tiers = [];
    for (let round = 0; round < ROUNDS; round++) {
      harness.slots(false);
      tiers.push(await forcedPass(harness));
      harness.slots(true);
      slots.push(await forcedPass(harness));
    }
    const stored = files.every((f) =>
      h.store.knownStates
        .list(h.worktreeId)
        .some((s) => s.check.testPath === testPath(f.name) && s.outcome === "pass"),
    );
    await h.scheduler.close();
    const bestCpu = (passes: typeof tiers) => Math.min(...passes.map((p) => p.cpuMs));
    const pass = (p: (typeof tiers)[number]) =>
      `${p.cpuMs.toFixed(1)} ms CPU a file in ${Math.round(p.ms)} ms`;
    console.log(
      `011-21 slots: 300 files at ${slots.map((p) => `${pass(p)}, ${p.pass.length} runs and ${p.commits} commits`).join("; ")}; one tier at ${tiers.map((p) => `${pass(p)}, ${p.pass.length} runs`).join("; ")} (best ${(bestCpu(slots) / bestCpu(tiers)).toFixed(2)} times)`,
    );
    expect(stored).toBe(true);
    for (const tier of tiers) expect(tier.pass).toHaveLength(1);
    for (const pass of slots) {
      expect(pass.pass).toHaveLength(FILES);
      expect(pass.pass.every((run) => run.files.length === 1)).toBe(true);
    }
    // Records that gather commit 71 to 148 times a pass on a light host and on CI. The fewer of two
    // passes commits 103 to 135 times at 2 CPUs and 161 to 176 at 4 CPUs with 3 burners, but 195
    // there at host load 57: slots that run 1 to 2 s end farther apart than a record waits, so this
    // budget is the limit of a loaded host. Without the gather they commit 224 to 226 times on a
    // light host, 277 to 292 at 2 CPUs (review wave-4, slice 2 overhead check; 011-99).
    expect(Math.min(...slots.map((p) => p.commits))).toBeLessThanOrEqual(FILES * 0.6);
    // On CI's 4 vCPUs, 28 main runs from 2026-10-22 to 10-26: 3.42 to 5.00 times in Node 22's
    // shard 3, higher as the shard's other files lengthen the slot pass, and 2.45 to 3.38 in the
    // Node 24 job; 5.00 missed the bound of 5 (run 40212162098). Here alone at load 5 to 12 on 24
    // CPUs: 2.70 to 3.56 on Node 24, 3.08 to 3.47 on Node 22; 2.82 to 4.29 at 2 CPUs and at 4 CPUs
    // with 3 burners, 3.67 to 4.07 without the gather (011-99). 20 ms more daemon CPU a slot took
    // it to 7.14 to 8.07 here (6.69 to 7.27 in 011-99), and CI's passes plus 20 ms a slot give 5.97
    // to 10.0: 5.5 is 10% over CI's highest and under all of those (011-217).
    expect(bestCpu(slots)).toBeLessThanOrEqual(bestCpu(tiers) * 5.5);
  });
});
