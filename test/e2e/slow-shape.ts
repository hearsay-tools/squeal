import { expect } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { blocks } from "./agree.js";
import type { E2E, FixtureOptions, Hooked } from "./harness.js";
import type { Source } from "./sources.js";

/*
 * Spec 004 Testing, end to end: the scenarios both repository shapes run
 * (`slow-vitest.test.ts`, `slow-node-test.test.ts`), for both plugins. A
 * slow file tests a committed CLI it spawns, so no import reaches it and only
 * the declared input keys it (001 D3); the harness writes the CLI with a
 * counter comment, so a rewrite is new bytes. A slow file's failure reads
 * and is inherited as any file's (004 D6, D8 as amended 2026-10-18). `slow.maxLoadPerCpu` is
 * high: on this shared host the load guard would defer the file past every
 * wait (004 `status.md`, wave 1).
 */

/** The committed CLI: `node <cli> hi` prints "HI" and `end`. */
export const CLI = (end: "!" | "?" = "!") =>
  `console.log(\`\${process.argv[2].toUpperCase()}${end}\`);\n`;

/** The slow tier's tuning every shape adds: the guard never defers on this host. */
export const SLOW_TUNING = { maxLoadPerCpu: 1_000 };

export interface Shape {
  /** Fixture options: the overlay with the slow files, the CLI, the policy. */
  readonly options: FixtureOptions;
  /** Repository path of the committed CLI the slow files spawn, a declared input of theirs. */
  readonly cli: string;
  /** Repository paths of the slow test files. */
  readonly slowFiles: readonly string[];
  /** Every check of a passing baseline. */
  readonly checks: number;
  /** A fast edit: the source written broken, the test file it fails and the check that fails. */
  readonly fast: {
    readonly source: Source;
    readonly broken: string;
    readonly testFile: string;
    readonly check: string;
  };
}

/** The check of the slow file that spawns the CLI. */
export const SLOW_CHECK = "shouts through the built CLI";

const failingNames = (s: StatusSnapshot) =>
  s.knownFailures
    .filter((f) => f.validity === "current" && f.check.kind === "test")
    .map((f) => (f.check.kind === "test" ? f.check.fullName : ""))
    .sort();

/** Exactly the checks `names` fail, each current. */
export const failsOnly =
  (...names: string[]) =>
  (s: StatusSnapshot) =>
    s.knownFailures.length === names.length &&
    JSON.stringify(failingNames(s)) === JSON.stringify([...names].sort());

/** The test files of the runs of `root` after its first `from` runs. */
export const ranSince = (e: E2E, root: string, from: number) =>
  new Set(
    e
      .runs(root)
      .slice(from)
      .flatMap((r) => r.testFiles),
  );

const slowCurrent = (shape: Shape) => (s: StatusSnapshot) =>
  s.slowTier?.current === shape.slowFiles.length && s.slowTier.pending === 0;

const slowPending = (shape: Shape) => (s: StatusSnapshot) =>
  s.slowTier?.pending === shape.slowFiles.length;

/** The main worktree's session started and its baseline settled: slow files included, the consumer idle. */
export async function baseline(e: E2E, shape: Shape): Promise<StatusSnapshot> {
  const start = await e.hook("session-start", e.main);
  expect(start).toMatchObject({ code: 0, stderr: "" });
  await e.daemonReady(e.main);
  return e.settle(
    e.main,
    "a passing baseline with the slow tier current",
    (s) => s.counts.current === shape.checks && failsOnly()(s) && slowCurrent(shape)(s),
  );
}

const named = (text: string | null, outcome: "FAIL" | "PASS") =>
  blocks(text ?? "", outcome).filter((name) => name.endsWith(` > ${SLOW_CHECK}`));

/**
 * Goals 1 to 4 in one worktree: in a turn, an edit and a CLI rewrite report the
 * fast failure while the slow files stay pending; a silent Stop runs them and
 * the next boundary delivers the slow failure as any file's; in a turn
 * again, a CLI rewrite alone makes them pending and `squeal run --slow` runs them.
 */
export async function fastFirstThenSlow(e: E2E, shape: Shape): Promise<void> {
  const base = await baseline(e, shape);
  for (const file of shape.slowFiles) expect(ranSince(e, e.main, 0)).toContain(file);
  expect(base.slowTier).toMatchObject({ testFiles: shape.slowFiles.length });
  const told = await e.hook("post-tool-batch", e.main);
  expect(told).toMatchObject({ code: 0, stderr: "" });

  // In a turn: the edit and a CLI rewrite. The fast file runs and reports; the slow files wait.
  let from = e.runs(e.main).length;
  let before = (await e.status(e.main)).revision;
  e.write(e.main, shape.fast.source, shape.fast.broken);
  e.writeAt(e.main, shape.cli, CLI("?"));
  const broken = await e.settleFast(
    e.main,
    "the fast failure, the slow files pending",
    (s) => failsOnly(shape.fast.check)(s) && slowPending(shape)(s),
    before,
  );
  expect(ranSince(e, e.main, from)).toEqual(new Set([shape.fast.testFile]));
  const fast = await e.hook("post-tool-batch", e.main);
  expect(blocks(fast.text ?? "", "FAIL").map((n) => n.split(" > ").at(-1))).toEqual([
    shape.fast.check,
  ]);
  expect(named(fast.text, "FAIL")).toEqual([]);
  expect((await e.status(e.main)).slowTier?.pending).toBe(shape.slowFiles.length);
  expect(ranSince(e, e.main, from)).toEqual(new Set([shape.fast.testFile]));

  // A silent Stop: the consumer is idle, the slow files run against the rewritten CLI.
  from = e.runs(e.main).length;
  const stop = await e.hook("stop", e.main);
  expectSilentStop(stop);
  const slowFailed = await e.settle(e.main, "the slow failure after Stop", (s) =>
    failsOnly(shape.fast.check, SLOW_CHECK)(s),
  );
  expect(ranSince(e, e.main, from)).toEqual(new Set(shape.slowFiles));
  const slow = await e.hook("post-tool-batch", e.main);
  expect(named(slow.text, "FAIL")).toHaveLength(1);
  expect(slow.text).toContain(`seen by Squeal's run at revision ${slowFailed.slowTier?.currentAt}`);
  expect(slow.text).not.toContain("against");
  expect(slowFailed.slowTier?.currentAt).toBeGreaterThanOrEqual(broken.revision);

  // In a turn again: a CLI rewrite alone re-keys the slow files, which wait; `run --slow` runs them.
  from = e.runs(e.main).length;
  before = (await e.status(e.main)).revision;
  e.writeAt(e.main, shape.cli, CLI());
  await e.settleFast(e.main, "the rewrite, the slow files pending", slowPending(shape), before);
  expect(ranSince(e, e.main, from)).toEqual(new Set());
  const run = await e.cli(e.main, ["run", "--slow"]);
  expect(run.code, run.stderr).toBe(0);
  await e.settle(
    e.main,
    "the slow files after run --slow",
    (s) => failsOnly(shape.fast.check)(s) && slowCurrent(shape)(s),
  );
  expect(ranSince(e, e.main, from)).toEqual(new Set(shape.slowFiles));
  const fixed = await e.hook("post-tool-batch", e.main);
  expect(named(fixed.text, "PASS")).toHaveLength(1);
  expect(named(fixed.text, "FAIL")).toEqual([]);
}

/**
 * Goal 5 and D6: a second worktree with every input equal inherits the slow
 * results and runs no slow file; a third, its CLI rewritten before its daemon
 * starts, inherits the fast results only and runs its slow files itself.
 */
export async function inheritsOnlyWithTheInputsEqual(
  e: E2E,
  shape: Shape,
  sessions: readonly [string, string],
): Promise<void> {
  const main = await baseline(e, shape);

  const equal = e.addWorktree("wt2");
  await e.hook("session-start", equal, { session_id: sessions[0] });
  await e.daemonReady(equal);
  const second = await e.settle(
    equal,
    "the equal worktree's baseline",
    (s) => s.counts.current === shape.checks && slowCurrent(shape)(s),
  );
  expect(e.runs(equal)).toEqual([]);
  expect(second.inherited.count).toBe(main.counts.current);

  const rewritten = e.addWorktree("wt3");
  e.writeAt(rewritten, shape.cli, CLI());
  await e.hook("session-start", rewritten, { session_id: sessions[1] });
  await e.daemonReady(rewritten);
  const third = await e.settle(
    rewritten,
    "the rewritten worktree's baseline",
    (s) => s.counts.current === shape.checks && failsOnly()(s) && slowCurrent(shape)(s),
  );
  expect(ranSince(e, rewritten, 0)).toEqual(new Set(shape.slowFiles));
  expect(third.inherited.count).toBeLessThan(main.counts.current);
}

/** A Stop with only slow files pending neither blocks nor waits for them (D9). */
function expectSilentStop(stop: Hooked): void {
  expect(stop).toMatchObject({ code: 0, stderr: "" });
  expect(stop.json?.decision).not.toBe("block");
}
