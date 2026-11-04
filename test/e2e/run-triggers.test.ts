import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { blocks } from "./agree.js";
import { type E2E, e2eSuite, PLUGINS, STRINGS } from "./harness.js";
import {
  DELAY,
  E2E_FILES,
  LINTED,
  STRINGS_LINTED,
  triggersFixture,
  UNIT_FILES,
} from "./run-triggers-fixture.js";
import { commitLines, firstStop, groupOf, lanesKeptApart } from "./run-triggers-moments.js";
import {
  CONTINUED,
  commitAll,
  hookExtra,
  installOxlint,
  pluginAt,
  promptOnceStored,
  ranAfter,
  settleEdit,
  stopBoth,
  timedRuns,
} from "./run-triggers-support.js";

/*
 * Spec 019 Testing, "Proof" (row 019-17), with no model: a repository with
 * three groups, unit at `edit`, lint at `commit`, e2e at `stop` after unit
 * with `maxParallel: 1`, driven through each shipped plugin's own hook
 * entries. Goal 1: each group runs at its moment and not before. D5: a
 * commit lints what it changed, and its line comes once, then its update
 * once. D4: Stop starts the e2e group, waits for it, and holds at most
 * `stop.maxHolds` times in a turn. D6: `squeal run e2e --wait` gives the
 * group's verdict. `run-triggers-control.test.ts` holds Goal 2.
 */

const fixture = e2eSuite();

/** Stop waits this long for the e2e group (`stop.slowWaitMs`); a long e2e run outlasts two waits. */
const WAIT_MS = 20_000;
const MAX_HOLDS = 2;
const LONG_DELAY_MS = 3 * WAIT_MS;
const PRIMER =
  /Check groups: unit( and tests \(the test files no group selects\))? after each edit; e2e at Stop, and Stop waits for them; lint when you commit; (`squeal run|the CLI's `run) <group> --wait 60000` runs one now\./;

const e2eTier = (s: StatusSnapshot) => groupOf(s, "e2e");
const e2ePending = (s: StatusSnapshot) => e2eTier(s).pending + e2eTier(s).notRun;
/** Every linted file listed, none failing, all waiting for a commit. */
const lintWaits = (s: StatusSnapshot) =>
  s.lint?.files === LINTED && s.lint.failing === 0 && s.lint.pending === LINTED;
const failing = (s: StatusSnapshot) =>
  s.knownFailures
    .filter((f) => f.validity === "current" && f.check.kind === "test")
    .map((f) => (f.check.kind === "test" ? f.check.fullName : ""))
    .sort();

/** How long an edit's runs are watched after its unit results, so a lane that should wait could start. */
const LINGER_MS = 3_000;

/**
 * Writes, waits for the edit's unit results and `LINGER_MS` more, and returns
 * status and the test files that ran: the e2e group stays pending.
 */
async function edit(e: E2E, write: () => void, accept: (s: StatusSnapshot) => boolean) {
  const from = timedRuns(e, e.main).length;
  const before = (await e.status(e.main)).revision;
  write();
  await settleEdit(e, e.main, "the edit's unit results", accept, before);
  await sleep(LINGER_MS);
  const settled = await settleEdit(e, e.main, "the edit's unit results", accept, before);
  return { settled, ran: ranAfter(e, e.main, from) };
}

describe.each(PLUGINS)("run triggers end to end, $name", (plugin) => {
  it("runs each group at its moment, reports a commit, and holds Stop at most maxHolds times", async (ctx) => {
    const stop = { slowWaitMs: WAIT_MS, maxHolds: MAX_HOLDS };
    const e = fixture(ctx, plugin, triggersFixture(true, stop));
    pluginAt(e);
    installOxlint(e.main);

    // The start, in a turn: the unit group runs alone; e2e waits for Stop, lint for a commit.
    expect(await e.hook("session-start", e.main)).toMatchObject({ code: 0, stderr: "" });
    const prompt = await promptOnceStored(e);
    await e.daemonReady(e.main);
    // The lint pass lists its files on its own, after the unit results can settle
    // (review of 0.1.400): the baseline waits for all of them, pending until a commit.
    const base = await settleEdit(
      e,
      e.main,
      `the unit baseline and lint's ${LINTED} files pending`,
      (s) => e2ePending(s) === 2 && lintWaits(s),
    );
    expect(ranAfter(e, e.main, 0)).toEqual(new Set(UNIT_FILES));
    expect(base.lint).toMatchObject({ files: LINTED, failing: 0, pending: LINTED });
    // D6: the first registration carries the primer (task 001-88); before the daemon
    // listed the files it also names the default group.
    const primed = await e.hook("post-tool-batch", e.main);
    expect(`${prompt.text}\n${primed.text}`).toMatch(PRIMER);

    // Goal 1: an edit runs the unit tests only. The e2e file it re-keys and its lint wait.
    const lintEdit = await edit(
      e,
      () => e.write(e.main, "strings", STRINGS_LINTED()),
      (s) => failing(s).length === 0,
    );
    expect(lintEdit.ran).toEqual(new Set(["test/strings.test.ts"]));
    expect(e2eTier(lintEdit.settled)).toMatchObject({
      pending: 2,
      activity: { kind: "waiting", for: "idle" },
    });
    expect(lintEdit.settled.lint).toMatchObject({ failing: 0 });
    const told = await e.hook("post-tool-batch", e.main);
    expect(told.text ?? "").not.toMatch(/FAIL\s+lint|^Commit /m);

    // D5, while the e2e files wait for Stop: the commit lints what it changed; its line
    // comes once, then its update once lint ends. The e2e files are not the commit's work:
    // no line counts them, and the update does not wait for them (row 019-28, lessons.md
    // Round 1 P1). Lint counts only the file the commit changed (P4).
    const sha = commitAll(e.main, "a debugger statement");
    const lines = await commitLines(e, sha);
    expect(lines).toEqual([
      `Commit ${sha.slice(0, 7)}: 0 known failures; lint 0 findings, 1 file still running`,
      `Commit ${sha.slice(0, 7)}: 0 known failures; lint 1 finding`,
    ]);
    const committed = await e.status(e.main);
    expect(committed.lint).toMatchObject({ failing: 1 });
    expect(e2ePending(committed), "the e2e files still wait for Stop").toBe(2);

    // D4 step 1: Stop starts the e2e group after unit and waits for it: a pass is silent.
    const from = timedRuns(e, e.main).length;
    const passed = await firstStop(e);
    expect(passed.quick.json, passed.quick.stdout).toBeNull();
    expect(passed.waiting.json, passed.waiting.stdout).toBeNull();
    expect(ranAfter(e, e.main, from)).toEqual(new Set(E2E_FILES));
    expect(e2eTier(await e.status(e.main))).toMatchObject({ current: 2, pending: 0 });

    // In a new turn: the unit failure is told at the boundary; the e2e failure is Stop's hold.
    await hookExtra(e, "user-prompt-submit", e.main);
    const broken = await edit(
      e,
      () => e.write(e.main, "strings", STRINGS("?")),
      (s) => failing(s).length === 1,
    );
    expect(broken.ran).toEqual(new Set(["test/strings.test.ts"]));
    const unit = await e.hook("post-tool-batch", e.main);
    expect(blocks(unit.text ?? "", "FAIL")).toEqual(["[unit] test/strings.test.ts > shouts"]);
    const held = await stopBoth(e, e.main);
    expect(held.quick.json).toBeNull();
    expect(held.waiting.json?.decision).toBe("block");
    expect(held.waiting.text).toMatch(
      /^Squeal policy checks puts the e2e group at stop and the e2e group ran at revision \d+: 1 check fails: \[e2e\] test\/e2e\/flow\.test\.ts > shouts end to end\./,
    );
    // Told in that hold: the continued Stop waits again, finds nothing new, and ends the turn.
    const toldStop = await stopBoth(e, e.main, CONTINUED);
    expect([toldStop.quick.json, toldStop.waiting.json]).toEqual([null, null]);
    const verdict = await e.cli(e.main, ["run", "e2e", "--wait", "60000"]);
    expect(verdict.code, verdict.stderr).toBe(1);
    expect(verdict.stdout).toMatch(
      /^Group e2e completed at revision \d+: 1 known failure: 1 test;/,
    );

    // A turn whose e2e run outlasts two waits: two holds at the bound, then the turn ends.
    await hookExtra(e, "user-prompt-submit", e.main);
    await edit(
      e,
      () => {
        e.write(e.main, "strings", STRINGS());
        e.writeAt(e.main, "src/delay.ts", DELAY(LONG_DELAY_MS));
      },
      (s) => failing(s).length === 0,
    );
    await e.hook("post-tool-batch", e.main);
    for (let hold = 1; hold <= MAX_HOLDS; hold++) {
      const out = await stopBoth(e, e.main, hold === 1 ? {} : CONTINUED);
      expect(out.quick.json, `hold ${hold}: the 2 s entry`).toBeNull();
      expect(out.waiting.json?.decision, `hold ${hold}`).toBe("block");
      expect(out.waiting.text).toMatch(
        /^Squeal policy checks puts the e2e group at stop and after 20 s 1 e2e test file is still not current at revision \d+: test\/e2e\/flow\.test\.ts\./,
      );
      expect(out.ms).toBeGreaterThanOrEqual(WAIT_MS);
    }
    const spent = await stopBoth(e, e.main, CONTINUED);
    expect([spent.quick.json, spent.waiting.json]).toEqual([null, null]);
    expect(spent.ms).toBeLessThan(WAIT_MS / 2);
    const done = await e.cli(e.main, ["run", "e2e", "--wait", String(2 * LONG_DELAY_MS)]);
    expect(done.code, done.stderr).toBe(0);
    expect(done.stdout).toMatch(/^Group e2e completed at revision \d+: no known failures;/);

    // D1, D3: e2e ran after unit at each revision, and never two of its files at once.
    expect(lanesKeptApart(timedRuns(e, e.main), E2E_FILES)).toEqual([]);
  }, 600_000);
});
