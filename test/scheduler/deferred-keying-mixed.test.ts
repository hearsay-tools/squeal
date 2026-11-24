import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { RunnerGate } from "../../src/core/scheduler/runner-gate.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { type CatchUpFile, CatchUpRunner, catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { groupPolicy, nodeTestGroup } from "./group-lanes-fixture.js";

/*
 * Review 0.1.616 B1 and B2 (repair 026-r1): spec 026 D1 defers each runner
 * on its own. With Vitest at `manual` beside node:test or pytest at `edit`,
 * the Vitest member of the composite gets no keying call at start, on an
 * edit, or for the other runner's explicit request; an explicit Vitest
 * request opens it, and it is deferred again after. A named wait's paths
 * that no listing holds open the deferred runner (B2).
 */

const UNIT: CheckGroup = { name: "unit", runner: "vitest", at: "manual" };
const A = "test/a.test.ts";
const B = "test/b.test.ts";
const VITEST: readonly CatchUpFile[] = [
  { path: A, ms: 10, imports: ["src/core.ts"] },
  { path: B, ms: 10, imports: ["src/other.ts"] },
];

/** The runner calls that open or reopen a keying host. */
const KEYING = ["environment", "testFiles", "closure", "invalidate", "affected", "recheck"];

/** `runner` named `name`, as the daemon names its members, each keying call counted. */
function member(runner: CatchUpRunner, name: string, counts: Map<string, number>): RunnerAdapter {
  return new Proxy(runner, {
    get(target, key, receiver) {
      if (key === "name") return name;
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (typeof key === "string" && KEYING.includes(key)) {
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return value.apply(target, args) as unknown;
      };
    },
  }) as RunnerAdapter;
}

interface Other {
  /** The member's adapter name in the daemon. */
  readonly name: string;
  readonly file: CatchUpFile;
  /** Its group at `edit`. */
  readonly group: CheckGroup;
}

const NODE_TEST: Other = {
  name: "node-test",
  file: { project: "nt", path: "nt/test/d.test.mjs", ms: 10, imports: ["src/core.ts"] },
  group: nodeTestGroup("n", "edit", "nt"),
};
const PYTEST: Other = {
  name: "pytest",
  file: { project: "py", path: "py/tests/test_f.py", ms: 10, imports: ["src/core.ts"] },
  group: { name: "p", runner: "pytest", at: "edit" },
};

async function mixed(other: Other) {
  const files = [...VITEST, other.file];
  const vitest = new Map<string, number>();
  const others = new Map<string, number>();
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...groupPolicy({ checks: [UNIT, other.group] }),
  };
  const gate = new RunnerGate(() => policy);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-026-r1-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const repo = catchUpRepo(files, ["README.md"]);
  const vitestRunner = new CatchUpRunner(VITEST);
  const otherRunner = new CatchUpRunner([other.file]);
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 4,
    policy,
    wrapRunner: () =>
      createCompositeRunner(
        [member(vitestRunner, "vitest", vitest), member(otherRunner, other.name, others)],
        [],
        gate,
      ),
    scheduler: {
      slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [0] },
      runnerGate: gate,
    },
  });
  await side.scheduler.start();
  await side.rest();
  return { side, vitest, others, vitestRunner, otherRunner };
}

const total = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);

describe("per-runner deferred keying (review 0.1.616 B1, B2)", { timeout: 60_000 }, () => {
  for (const other of [NODE_TEST, PYTEST]) {
    it(`keys ${other.name} at edit and never wakes a manual-only Vitest in the background`, async () => {
      const { side, vitest, others, vitestRunner } = await mixed(other);
      expect(Object.fromEntries(vitest), "no Vitest call at start").toEqual({});
      expect(others.get("environment"), `${other.name} is keyed at start`).toBeGreaterThan(0);
      await expect.poll(() => side.current(other.file.path), { timeout: 20_000 }).toBe(true);

      await side.edit("watch", "src/core.ts");
      await side.rest();
      await side.edit("watch", "README.md");
      await side.rest();
      await side.scheduler.handleBatch({ trigger: "interval", paths: [] });
      await side.rest();
      expect(Object.fromEntries(vitest), "no Vitest call on an edit").toEqual({});
      expect(others.get("invalidate"), `${other.name} sees the edits`).toBeGreaterThan(0);
      await expect.poll(() => side.current(other.file.path), { timeout: 20_000 }).toBe(true);

      // The other runner's explicit request leaves Vitest deferred.
      await side.scheduler.requestGroup(other.group.name);
      await side.rest();
      expect(Object.fromEntries(vitest), `a ${other.name} request opens no Vitest`).toEqual({});

      // An explicit Vitest request opens it, lists and runs its files.
      expect(await side.scheduler.requestGroup("unit")).toMatchObject({ queued: 2 });
      await expect.poll(() => side.current(A) && side.current(B), { timeout: 20_000 }).toBe(true);
      expect(vitest.get("environment")).toBeGreaterThan(0);
      expect(vitest.get("testFiles")).toBeGreaterThan(0);
      expect(vitestRunner.runs.flatMap((r) => r.files.map((f) => f.path)).sort()).toEqual([A, B]);

      // Deferred again after: an edit re-keys Vitest's files from their closures, no call.
      await side.rest();
      const before = total(vitest);
      await side.edit("watch", "src/core.ts");
      await side.rest();
      expect(total(vitest), "the edit owes Vitest its runner part").toBe(before);
      expect(side.current(A), "a.test.ts reads the edited file").toBe(false);
      expect(side.current(B)).toBe(true);
      await expect.poll(() => side.current(other.file.path), { timeout: 20_000 }).toBe(true);

      // The next Vitest request catches up the owed invalidation, then runs what moved.
      await side.scheduler.requestGroup("unit");
      await expect.poll(() => side.current(A), { timeout: 20_000 }).toBe(true);
      expect(vitest.get("invalidate")).toBeGreaterThan(0);
    });
  }

  it("a named wait's path no listing holds opens the deferred runner (B2)", async () => {
    const { side, vitest } = await mixed(NODE_TEST);
    expect(Object.fromEntries(vitest)).toEqual({});
    const answer = await side.scheduler.readers?.([A]);
    expect(vitest.get("testFiles"), "the named path lists Vitest's files").toBeGreaterThan(0);
    expect(answer?.readers?.[A]?.map((ref) => ref.path)).toEqual([A]);
  });
});
