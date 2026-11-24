import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { background, ENV, options, REF, setup, until } from "./lane-fixture.js";

/*
 * Spec 026 D8.3 (row 026-12): a lane with `planning: "remote"` plans on its
 * remote host while it is ready, warms its first `affected` before it says
 * so, and makes no call on the runner here: no local runner host starts.
 * When the remote is down, `whenLost: "local"` plans here and `not-run`
 * rejects the call, naming the remote. A call in flight refuses a sleep;
 * after the lane closed, no call reaches the runner here.
 *
 * Review 0.1.619 B4: a run that stays here without asking the remote, a
 * tier the lane does not send or a tier whose files all read the
 * repository, opens the runner here: each later change and touch reaches it.
 */

const REMOTE = { planning: "remote" as const, lanes: ["edit", "background"] as const };
const MISSING = "tests need python3; not found on PATH there";

describe("planning on the remote (026 D8.3)", () => {
  it("plans, invalidates and runs there with no call on the runner here", async () => {
    const s = await setup(REMOTE);
    expect(s.statuses.at(-1)).toMatch(/: edit and background runs and planning of vitest go there/);
    expect(await s.lane.testFiles()).toEqual([REF]);
    expect(await s.lane.environment()).toEqual([ENV]);
    expect(await s.lane.affected(["src/a.ts"])).toEqual({ direct: [REF], transitive: [] });
    expect((await s.lane.closure(REF)).paths).toEqual(["src/a.ts", "test/a.test.ts"]);
    expect(await s.lane.enumerate(REF)).toEqual([]);
    writeFileSync(join(s.root, "src/a.ts"), "export const a = 2;\n");
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    expect(readFileSync(join(s.remoteRoot, "src/a.ts"), "utf8")).toBe("export const a = 2;\n");
    await s.lane.run([REF], options({ lane: "vitest", workers: 2 }));
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toEqual([REF.path, REF.path]);
    expect(s.localCalls).toEqual([]);
    expect(s.localFiles).toEqual([]);
    expect(s.remoteCalls).toEqual(
      expect.arrayContaining(["testFiles", "affected src/a.ts", "closure test/a.test.ts"]),
    );
  });

  it("warms the remote's first affected before it reports ready", async () => {
    const s = await setup(REMOTE);
    // The comparison reads the remote's environment, then the warm-up asks `affected([])`.
    expect(s.remoteCalls.slice(0, 2)).toEqual(["environment", "affected "]);
    const local = await setup();
    expect(local.remoteCalls).not.toContain("affected ");
  });

  it("sends a queued edit before the next planning call", async () => {
    const s = await setup({ ...REMOTE, eager: false });
    const answer = s.lane.affected([]);
    writeFileSync(join(s.root, "src/a.ts"), "export const a = 3;\n");
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    await answer;
    await s.lane.affected(["src/a.ts"]);
    expect(readFileSync(join(s.remoteRoot, "src/a.ts"), "utf8")).toBe("export const a = 3;\n");
    expect(s.localCalls).toEqual([]);
  });

  it("connects again after a sleep at the next planning call", async () => {
    const s = await setup(REMOTE);
    expect(await s.lane.sleep(async () => {})).toBe("slept");
    await s.lane.testFiles();
    expect(s.events).toEqual(["connect", "close", "connect"]);
    expect(s.localCalls).toEqual([]);
  });

  it("keeps planning here under planning local", async () => {
    const s = await setup({ lanes: ["edit", "background"] });
    // The connect's comparison read the environment here; only the calls after it count.
    s.localCalls.length = 0;
    await s.lane.affected(["src/a.ts"]);
    await s.lane.closure(REF);
    expect(s.localCalls).toEqual(["affected src/a.ts", "closure test/a.test.ts"]);
    expect(s.remoteCalls).not.toContain("affected src/a.ts");
  });
});

describe("planning while the remote is down (026 D8.3)", () => {
  it("plans here under whenLost local, and invalidates here from then on", async () => {
    const s = await setup({ ...REMOTE, refusal: MISSING });
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    expect(s.localCalls).toEqual([]);
    expect(await s.lane.affected(["src/a.ts"])).toEqual({ direct: [REF], transitive: [] });
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    expect(s.localCalls).toEqual(["affected src/a.ts", "invalidate src/a.ts"]);
  });

  it("rejects the call, named, with no call here under whenLost not-run", async () => {
    const s = await setup({ ...REMOTE, refusal: MISSING, whenLost: "not-run" });
    await expect(s.lane.affected(["src/a.ts"])).rejects.toThrow(
      `remote box refused: ${MISSING}; not planned here (whenLost "not-run")`,
    );
    await expect(s.lane.testFiles()).rejects.toThrow(/not planned here/);
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    const report = await s.lane.run([REF], background());
    expect(report.completedFiles).toEqual([]);
    expect(s.localCalls).toEqual([]);
    expect(s.localFiles).toEqual([]);
  });
});

describe("planning and the lane's sleep and close (026 D8.3, review 0.1.617)", () => {
  it("is busy while a planning call is in flight, and marks its activity", async () => {
    const s = await setup(REMOTE);
    const marks = s.activity.length;
    const answer = s.lane.affected([]);
    expect(s.lane.busy()).toBe("a planning call is on remote box");
    expect(await s.lane.sleep(async () => {})).toEqual({
      busy: "a planning call is on remote box",
    });
    await answer;
    expect(s.lane.busy()).toBeNull();
    expect(s.activity.length).toBeGreaterThan(marks);
  });

  it("starts nothing here once the lane closed, also for a call waiting for its connect", async () => {
    const s = await setup({ ...REMOTE, eager: false });
    const waiting = s.lane.affected([]);
    await until(() => s.connects.length === 1);
    await s.lane.close();
    await expect(waiting).rejects.toThrow("remote box: its lane closed; not planned here");
    await expect(s.lane.testFiles()).rejects.toThrow(/its lane closed/);
    expect(s.localCalls).toEqual([]);
  });
});

describe("a run here under remote planning opens the runner here (review 0.1.619 B4)", () => {
  const GIT = { project: "", path: "test/git.test.ts" };
  const CHANGE = { path: "src/a.ts", kind: "change" as const };
  const TOUCH = { path: "src/a.ts", kind: "touch" as const };

  it("sends later changes and touches here after a tier the lane does not send ran here", async () => {
    const s = await setup({ planning: "remote", lanes: ["background"] });
    await s.lane.run([REF], options({ lane: "vitest" }));
    expect(s.localFiles).toEqual([REF.path]);
    await s.lane.invalidate([CHANGE]);
    await s.lane.invalidate([TOUCH]);
    expect(s.localCalls).toEqual(["invalidate src/a.ts", "invalidate src/a.ts"]);
    expect(s.remoteCalls.filter((c) => c.startsWith("invalidate"))).toHaveLength(2);
  });

  it("sends later changes and touches here after a tier whose files all read the repository", async () => {
    const s = await setup({
      ...REMOTE,
      needsRepository: ["test/git.*"],
      files: { "test/git.test.ts": "import '../src/a';\n" },
    });
    await s.lane.run([GIT], background());
    expect(s.localFiles).toEqual([GIT.path]);
    expect(s.remoteRuns).toEqual([]);
    await s.lane.invalidate([CHANGE]);
    await s.lane.invalidate([TOUCH]);
    expect(s.localCalls).toEqual(["invalidate src/a.ts", "invalidate src/a.ts"]);
  });

  it("makes no call here while every run and invalidation goes remote", async () => {
    const s = await setup(REMOTE);
    await s.lane.run([REF], background());
    await s.lane.invalidate([CHANGE]);
    await s.lane.invalidate([TOUCH]);
    expect(s.remoteRuns).toEqual([REF.path]);
    expect(s.localCalls).toEqual([]);
    expect(s.localFiles).toEqual([]);
  });
});
