import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import {
  keyingDeferred,
  runnerKeyingDeferred,
  stopAsksTests,
} from "../../src/core/scheduler/deferred-keying.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  type CatchUpRunner,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { groupPolicy, inTurn, nodeTestGroup } from "./group-lanes-fixture.js";

/*
 * Spec 026 D1 (row 026-05): with no test group at `edit` or `pause`, the
 * scheduler makes no runner keying call at start, at an edit (a source or
 * `README.md`), a touch, a recheck, an observed update, an import or an
 * idle re-walk. Edits re-key from the stored closures; an explicit request
 * opens the runner, keys and runs accurately, and owes again after.
 */

const UNIT: CheckGroup = { name: "unit", runner: "vitest", at: "manual" };
const LINT: CheckGroup = { name: "lint", lint: ["oxlint"], at: "edit" };
const DEFERRED: Partial<Policy> = { checks: [UNIT, LINT] };

const FILES: readonly CatchUpFile[] = [
  { path: "test/a.test.ts", ms: 10, imports: ["src/core.ts"] },
  { path: "test/b.test.ts", ms: 10, imports: ["src/other.ts"] },
];
const A = "test/a.test.ts";
const B = "test/b.test.ts";

/** The runner calls that open or reopen a keying host. */
const KEYING = ["environment", "testFiles", "closure", "invalidate", "affected", "recheck"];

/** The fake runner with each keying call counted by name; every method bound to it. */
function counting(runner: CatchUpRunner, counts: Map<string, number>): RunnerAdapter {
  return new Proxy(runner, {
    get(target, name, receiver) {
      const value: unknown = Reflect.get(target, name, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (typeof name === "string" && KEYING.includes(name)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        return value.apply(target, args) as unknown;
      };
    },
  }) as RunnerAdapter;
}

interface Counted {
  readonly side: CatchUpSide;
  readonly counts: Map<string, number>;
}

async function started(
  repo: CatchUpRepo,
  policy: Partial<Policy>,
  beforeStart?: (side: CatchUpSide) => Promise<void>,
): Promise<Counted> {
  const counts = new Map<string, number>();
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-026-05-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const side = catchUpSide(repo, repo.main, {
    files: FILES,
    hostSlots: 4,
    policy: { ...DEFAULT_POLICY, ...RUN_MISSING, ...policy },
    wrapRunner: (runner) => counting(runner, counts),
    // A group lane's shared slot, as `groupSide` gives it (row 019-10).
    scheduler: { slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] } },
  });
  await beforeStart?.(side);
  await side.scheduler.start();
  await side.rest();
  return { side, counts };
}

const total = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);

/** Every background path the deferred runner must not answer. */
async function background(side: CatchUpSide): Promise<void> {
  await side.edit("watch", "src/core.ts");
  await side.rest();
  await side.edit("watch", "README.md");
  await side.rest();
  // A touch: the bytes stay, the stat moves.
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(side.root, "src/other.ts"), later, later);
  const hasher = createFsHasher(side.root, "sha1");
  await side.scheduler.handleBatch({
    trigger: "watch",
    paths: await statCandidates(["src/other.ts"], hasher),
  });
  await side.rest();
  await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
  expect(side.scheduler.refreshObserved()).toBe(true);
  expect(await side.scheduler.requestImports([""], ["refs/squeal/ci"])).toBe(true);
  await side.rest();
}

describe("deferred runner keying (spec 026 D1)", { timeout: 60_000 }, () => {
  it("defers a runner only when no group that can own its files runs at edit or pause", () => {
    const policy = (checks: readonly CheckGroup[], extra: Partial<Policy> = {}): Policy => ({
      ...DEFAULT_POLICY,
      ...extra,
      checks,
    });
    expect(keyingDeferred(DEFAULT_POLICY), "the default tests group is at edit").toBe(false);
    expect(keyingDeferred(policy([UNIT, LINT]))).toBe(true);
    expect(keyingDeferred(policy([{ ...UNIT, at: "pause" }]))).toBe(false);
    expect(keyingDeferred(policy([{ ...UNIT, at: "stop" }]))).toBe(true);
    expect(keyingDeferred(policy([{ ...UNIT, at: "commit" }]))).toBe(true);
    // A group of part of the files leaves the rest to the default `tests` group, at edit.
    expect(keyingDeferred(policy([{ ...UNIT, tests: ["test/e2e/**"] }]))).toBe(false);
    expect(keyingDeferred(policy([{ ...UNIT, project: "web" }]))).toBe(false);
    // An earlier eager group of the runner wins over a later manual one.
    expect(
      keyingDeferred(policy([{ ...UNIT, name: "e", tests: ["x/**"], at: "edit" }, UNIT])),
    ).toBe(false);
    // `groupPolicy`'s node:test entries are `nt` and `ns`, its pytest entry `py`.
    const entries: Policy = { ...DEFAULT_POLICY, ...groupPolicy() };
    const py: CheckGroup = { name: "p", runner: "pytest", at: "manual" };
    const nodes = { ...entries, checks: [UNIT, py, nodeTestGroup("n", "manual", "nt")] };
    expect(runnerKeyingDeferred(nodes, "pytest")).toBe(true);
    expect(keyingDeferred(nodes), "entry ns falls to `tests`, at edit").toBe(false);
    const both = { ...nodes, checks: [...nodes.checks, nodeTestGroup("m", "stop", "ns")] };
    expect(keyingDeferred(both)).toBe(true);
    expect(stopAsksTests(both)).toBe(true);
    expect(stopAsksTests(policy([UNIT, LINT]))).toBe(false);
  });

  it("makes no keying call on any background path, and keys at an explicit request", async () => {
    const repo = catchUpRepo(FILES, ["README.md"]);
    const { side, counts } = await started(repo, DEFERRED);
    expect(Object.fromEntries(counts), "no call at start").toEqual({});

    await background(side);
    expect(Object.fromEntries(counts), "no call on a background path").toEqual({});
    expect(side.runner.runs).toEqual([]);
    expect(side.current(A) || side.current(B)).toBe(false);

    expect(await side.scheduler.requestGroup("unit")).toMatchObject({ queued: 2 });
    await expect.poll(() => side.current(A) && side.current(B), { timeout: 20_000 }).toBe(true);
    expect(counts.get("environment")).toBeGreaterThan(0);
    expect(counts.get("testFiles")).toBeGreaterThan(0);

    // After the wake, an edit is re-keyed from the stored closures, with no runner call.
    const before = total(counts);
    await side.edit("watch", "src/core.ts");
    await side.rest();
    expect(total(counts), "the edit owes its runner part").toBe(before);
    expect(side.current(A), "a.test.ts reads the edited file").toBe(false);
    expect(side.current(B)).toBe(true);

    // The next request catches up the owed refinement first, then runs what it re-keyed.
    const ran = side.runner.runs.length;
    await side.scheduler.requestGroup("unit");
    await expect.poll(() => side.current(A), { timeout: 20_000 }).toBe(true);
    expect(counts.get("invalidate")).toBeGreaterThan(0);
    expect(side.runner.runs.slice(ran).flatMap((run) => run.files.map((f) => f.path))).toEqual([A]);
  });

  it("starts with no keying call after an eager daemon, its files unknown, never current", async () => {
    const repo = catchUpRepo(FILES, ["README.md"]);
    const eager = await started(repo, {});
    await expect
      .poll(() => eager.side.current(A) && eager.side.current(B), { timeout: 20_000 })
      .toBe(true);
    await eager.side.scheduler.close();

    const { side, counts } = await started(repo, DEFERRED);
    expect(Object.fromEntries(counts)).toEqual({});
    expect(side.current(A) || side.current(B), "no key from before the start stands").toBe(false);
    await side.scheduler.requestFullSuite();
    await expect.poll(() => side.current(A) && side.current(B), { timeout: 20_000 }).toBe(true);
    expect(side.runner.runs, "the stored results stand at their keys").toEqual([]);
  });

  it("an eager policy keys at start, as before", async () => {
    const repo = catchUpRepo(FILES);
    const { counts } = await started(repo, {});
    expect(counts.get("environment")).toBeGreaterThan(0);
    expect(counts.get("testFiles")).toBeGreaterThan(0);
  });

  it("Stop's required group opens the runner at the turn's end", async () => {
    const repo = catchUpRepo(FILES);
    const turn: { end?: () => Promise<void> } = {};
    const { side, counts } = await started(
      repo,
      { checks: [{ ...UNIT, at: "stop" }] },
      async (s) => {
        turn.end = (await inTurn(s)).end;
      },
    );
    await side.edit("watch", "src/core.ts");
    await side.rest();
    expect(Object.fromEntries(counts), "no call before Stop").toEqual({});
    await turn.end?.();
    await expect.poll(() => side.current(A) && side.current(B), { timeout: 20_000 }).toBe(true);
    expect(counts.get("environment")).toBeGreaterThan(0);
  });

  it("a `commit` group's ask opens the runner and runs the committed file's readers", async () => {
    const repo = catchUpRepo(FILES);
    const eager = await started(repo, {});
    await expect
      .poll(() => eager.side.current(A) && eager.side.current(B), { timeout: 20_000 })
      .toBe(true);
    await eager.side.scheduler.close();

    const { side, counts } = await started(repo, { checks: [{ ...UNIT, at: "commit" }] });
    await side.edit("watch", "src/core.ts");
    await side.rest();
    expect(Object.fromEntries(counts), "no call before the commit").toEqual({});
    git(side.root, ["commit", "-qam", "core"]);
    await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await expect.poll(() => side.current(A), { timeout: 20_000 }).toBe(true);
    expect(counts.get("environment")).toBeGreaterThan(0);
    expect(side.runner.runs.flatMap((run) => run.files.map((f) => f.path))).toEqual([A]);
  });
});
