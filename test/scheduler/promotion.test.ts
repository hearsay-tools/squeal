import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, side } from "./claims-fixture.js";

/*
 * Spec 011 C15 (task 011-11), from issue 14's probe
 * (`docs/specifications/001-core-loop/research/probes/issue-14/`): one lane,
 * tiers of one file; A runs, B and Z are queued, and a named wait on Z
 * promotes it.
 */
const [A, B, Z] = [fileName(0), fileName(1), fileName(2)];
const ref = (path: string) => ({ project: "", path });
const order = (runs: readonly (readonly { path: string }[])[]) =>
  runs.map((files) => files.map((f) => f.path));

describe("scheduler: a named wait promotes its test file (spec 011 C15)", () => {
  it("with A running and B, Z queued, Z starts before B, and B still runs", async () => {
    const { main } = claimRepo(3);
    const a = side(main, { count: 3, tierSize: 1, policy: RUN_MISSING });
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.phase(A)).toBe("running");
    expect([a.phase(B), a.phase(Z)]).toEqual(["queued", "queued"]);

    await a.scheduler.promote([ref(Z)], 60_000);
    // Nothing running is cancelled or split for it.
    expect(a.phase(A)).toBe("running");
    a.runner.release();
    await a.scheduler.idle();
    expect(order(a.runner.runs)).toEqual([[A], [Z], [B]]);
    expect(a.passing()).toBe(3);
  });

  it("without a promotion the order is the old one", async () => {
    const { main } = claimRepo(3);
    const a = side(main, { count: 3, tierSize: 1, policy: RUN_MISSING });
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.phase(A)).toBe("running");
    a.runner.release();
    await a.scheduler.idle();
    expect(order(a.runner.runs)).toEqual([[A], [B], [Z]]);
  });

  it("a promotion past its deadline orders nothing", async () => {
    const { main } = claimRepo(3);
    const a = side(main, { count: 3, tierSize: 1, policy: RUN_MISSING });
    a.runner.hold();
    await a.scheduler.start();
    await expect.poll(() => a.phase(A)).toBe("running");
    await a.scheduler.promote([ref(Z)], 0);
    a.runner.release();
    await a.scheduler.idle();
    expect(order(a.runner.runs)).toEqual([[A], [B], [Z]]);
  });

  it("a promoted file whose key another worktree runs waits for its claimant (C7)", async () => {
    const { main, other } = claimRepo(3);
    const b = side(other, { count: 3, tierSize: 1, policy: RUN_MISSING });
    b.runner.hold();
    await b.scheduler.start();
    // The other worktree runs A's key: its run is the result this wait needs.
    await expect.poll(() => b.phase(A)).toBe("running");

    const a = side(main, { count: 3, tierSize: 1, policy: RUN_MISSING });
    a.runner.hold();
    await a.scheduler.start();
    await a.scheduler.promote([ref(A)], 60_000);
    await expect.poll(() => a.runner.runs.length).toBe(1);
    // The claimed key stays queued here while the claimant runs it: no duplicate run.
    expect(order(a.runner.runs)).toEqual([[B]]);
    expect(a.phase(A)).toBe("queued");
    b.runner.release();
    await expect.poll(() => b.phase(A)).toBeNull();
    a.runner.release();
    await Promise.all([a.scheduler.idle(), b.scheduler.idle()]);
    expect(a.runner.ran(A) + b.runner.ran(A)).toBe(1);
    expect(a.passing()).toBe(3);
  });
});
