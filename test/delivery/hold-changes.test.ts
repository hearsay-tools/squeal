import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { pidNamespace, readProcStat } from "../../src/core/delivery/harness-process.js";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { type CommandHoldEntry, commandHoldMetaKey } from "../../src/core/scheduler/hold-rows.js";
import type { Consumer, HarnessProcess } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  batch,
  gitMay,
  HELPER,
  heldPaths,
  helperReturning,
  holdSide,
  mergeRepo,
} from "../scheduler/merge-hold-fixture.js";
import { fixedStatus } from "./fakes.js";

/*
 * Review 0.1.269, B2 (row 011-73; spec 011 C8 as amended 2026-10-21: a
 * hold's start and end are told as liveness is, once per change and in one
 * line each; C9: two command holds may hold at once). With overlapping
 * holds, each consumer is told each hold's start and end once, by name, and
 * `validating again` only when no hold remains. The command holds' row is
 * written as `squeal hold` (row 011-74) writes it; a real scheduler holds
 * the merge.
 */

/** `pid`'s identity as a harness process is recorded (C8). */
function processOf(pid: number): HarnessProcess {
  const stat = readProcStat(pid);
  const namespace = pidNamespace();
  if (stat === null || namespace === null) throw new Error(`no /proc entry for ${pid}`);
  return { pid, startTime: stat.startTime, pidNamespace: namespace };
}

/** A `sleep` that lives through the test. */
function sleeper(): HarnessProcess {
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  if (child.pid === undefined) throw new Error("sleep did not start");
  return processOf(child.pid);
}

/** One live `squeal hold` of `command`, its wrapper `wrapper`. */
function entry(token: string, command: string, wrapper: HarnessProcess): CommandHoldEntry {
  const since = Date.now();
  return { token, since, until: since + 60 * 60_000, command, wrapper, child: null };
}

const started = (command: string, pid: number) =>
  new RegExp(
    `^SQUEAL · validation on hold at revision \\d+: \`squeal hold\` runs \`${command}\` \\(pid ${pid}\\)\\. Edits are recorded and not run until it exits, at most until \\d\\d:\\d\\d:\\d\\d; \`squeal start\` ends the hold\\.$`,
  );
const ended = (command: string, pid: number, still: string) =>
  new RegExp(
    `^SQUEAL · a hold ended at revision \\d+: the hold for \`${command}\` \\(pid ${pid}\\) ended; still on hold ${still}\\.$`,
  );
const resumed = (command: string, pid: number) =>
  new RegExp(
    `^SQUEAL · validating again at revision \\d+: the hold for \`${command}\` \\(pid ${pid}\\) ended; \\d+ test files? queued(, \\d+ running)?\\.$`,
  );
const MERGE_STARTED =
  /^SQUEAL · validation on hold at revision \d+: git lists 1 unmerged path \(src\/helper\.ts\)\. No test runs until git lists none: resolve it and `git add` it, or abort\.$/;

async function live() {
  const repo = mergeRepo();
  const side = holdSide(repo);
  await side.scheduler.start();
  await side.scheduler.idle();
  const delivery = createDelivery(side.store, { status: fixedStatus() });
  const consumer = async (sessionId: string): Promise<Consumer> => {
    const c: Consumer = { worktreeId: side.worktreeId, sessionId, agentId: "main" };
    await delivery.register(c);
    return c;
  };
  /** Writes the command holds' row. */
  const commands = (...entries: CommandHoldEntry[]) =>
    side.store.meta.set(commandHoldMetaKey(side.worktreeId), JSON.stringify({ v: 1, entries }));
  /** The hold lines one tool boundary delivers, each checked against its change; `null` for none. */
  const told = async (c: Consumer, stop = false): Promise<string[] | null> => {
    const delta = await delivery.onToolBoundary(c, stop ? { stop } : {});
    if (delta === null) return null;
    const text = formatDelta(delta, "squeal", undefined, stop ? "full" : "news").split("\n");
    const lines = text.filter((l) =>
      /^SQUEAL · (validation on hold|a hold ended|validating again)/.test(l),
    );
    expect(lines).toHaveLength(delta.holds?.length ?? 0);
    return lines;
  };
  return { repo, side, consumer, commands, told };
}

describe("delivery: overlapping holds (review 0.1.269, B2)", { timeout: 60_000 }, () => {
  it("A, then B, then B's end, then A's end: each told once, by name", async () => {
    const { consumer, commands, told } = await live();
    const c = await consumer("s1");
    expect(await told(c)).toBeNull();
    const [self, other] = [processOf(process.pid), sleeper()];
    const a = entry("ta", "gate A", self);
    const b = entry("tb", "gate B", other);

    commands(a);
    expect(await told(c)).toEqual([expect.stringMatching(started("gate A", self.pid))]);
    expect(await told(c)).toBeNull();
    commands(a, b);
    expect(await told(c)).toEqual([expect.stringMatching(started("gate B", other.pid))]);
    expect(await told(c)).toBeNull();
    commands(a);
    expect(await told(c)).toEqual([
      expect.stringMatching(ended("gate B", other.pid, `for \`gate A\` \\(pid ${self.pid}\\)`)),
    ]);
    expect(await told(c)).toBeNull();
    commands();
    expect(await told(c)).toEqual([expect.stringMatching(resumed("gate A", self.pid))]);
    expect(await told(c)).toBeNull();
  });

  it("two holds of the same command stay two: a replaced one is an end and a start", async () => {
    const { consumer, commands, told } = await live();
    const c = await consumer("s1");
    const [self, other] = [processOf(process.pid), sleeper()];
    const first = entry("t1", "npm run gate", self);
    const second = entry("t2", "npm run gate", other);
    const third = entry("t3", "npm run gate", self);

    commands(first);
    expect(await told(c)).toEqual([expect.stringMatching(started("npm run gate", self.pid))]);
    commands(second);
    expect(await told(c)).toEqual([
      expect.stringMatching(
        ended("npm run gate", self.pid, `for \`npm run gate\` \\(pid ${other.pid}\\)`),
      ),
      expect.stringMatching(started("npm run gate", other.pid)),
    ]);
    commands(second, third);
    expect(await told(c)).toEqual([expect.stringMatching(started("npm run gate", self.pid))]);
    commands(third);
    expect(await told(c)).toEqual([
      expect.stringMatching(
        ended("npm run gate", other.pid, `for \`npm run gate\` \\(pid ${self.pid}\\)`),
      ),
    ]);
    commands();
    expect(await told(c)).toEqual([expect.stringMatching(resumed("npm run gate", self.pid))]);
    expect(await told(c)).toBeNull();
  });

  it("two ends at once: one `a hold ended` line, then one `validating again`", async () => {
    const { consumer, commands, told } = await live();
    const c = await consumer("s1");
    const [self, other] = [processOf(process.pid), sleeper()];
    commands(entry("ta", "gate A", self), entry("tb", "gate B", other));
    expect(await told(c)).toEqual([
      expect.stringMatching(started("gate A", self.pid)),
      expect.stringMatching(started("gate B", other.pid)),
    ]);
    commands();
    expect(await told(c)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^SQUEAL · a hold ended at revision \\d+: the hold for \`gate A\` \\(pid ${self.pid}\\) ended\\.$`,
        ),
      ),
      expect.stringMatching(resumed("gate B", other.pid)),
    ]);
    expect(await told(c)).toBeNull();
  });

  it("a merge hold with a command hold behind it: the command's start, the merge's end, then the command's", async () => {
    const { repo, side, consumer, commands, told } = await live();
    const c = await consumer("s1");
    const self = processOf(process.pid);
    expect(gitMay(repo.main, ["merge", "side"])).toBe(1);
    await batch(side, HELPER);
    await side.scheduler.idle();
    expect(heldPaths(side)).toEqual([HELPER]);
    expect(await told(c)).toEqual([expect.stringMatching(MERGE_STARTED)]);

    commands(entry("t1", "npm run gate", self));
    expect(await told(c)).toEqual([expect.stringMatching(started("npm run gate", self.pid))]);
    expect(await told(c)).toBeNull();

    // `git add` ends the merge hold; the command hold still holds.
    writeFileSync(join(repo.main, HELPER), helperReturning(4));
    git(repo.main, ["add", HELPER]);
    await batch(side, HELPER);
    await expect.poll(() => heldPaths(side), { timeout: 10_000 }).toBeNull();
    expect(await told(c)).toEqual([
      expect.stringMatching(
        /^SQUEAL · a hold ended at revision \d+: git lists no unmerged path; still on hold for `npm run gate` \(pid \d+\)\.$/,
      ),
    ]);
    expect(await told(c)).toBeNull();

    commands();
    expect(await told(c)).toEqual([expect.stringMatching(resumed("npm run gate", self.pid))]);
    expect(await told(c)).toBeNull();
  });

  it("two consumers are each told each change once, and one registered on hold only its end", async () => {
    const { consumer, commands, told } = await live();
    const [one, two] = [await consumer("s1"), await consumer("s2")];
    const self = processOf(process.pid);
    commands(entry("ta", "gate A", self));
    expect(await told(one)).toEqual([expect.stringMatching(started("gate A", self.pid))]);
    expect(await told(one)).toBeNull();
    const three = await consumer("s3");
    expect(await told(two)).toEqual([expect.stringMatching(started("gate A", self.pid))]);
    expect(await told(two)).toBeNull();
    expect(await told(three)).toBeNull();

    commands();
    for (const c of [two, one, three]) {
      expect(await told(c)).toEqual([expect.stringMatching(resumed("gate A", self.pid))]);
      expect(await told(c)).toBeNull();
    }
  });

  it("a change first seen at Stop is told there, once, and not at the next boundary", async () => {
    const { consumer, commands, told } = await live();
    const c = await consumer("s1");
    const self = processOf(process.pid);
    commands(entry("ta", "gate A", self));
    expect(await told(c, true)).toEqual([expect.stringMatching(started("gate A", self.pid))]);
    expect(await told(c)).toBeNull();
    commands();
    expect(await told(c, true)).toEqual([expect.stringMatching(resumed("gate A", self.pid))]);
    expect(await told(c)).toBeNull();
  });
});
