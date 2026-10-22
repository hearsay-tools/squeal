import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, onTestFinished } from "vitest";
import { pidNamespace, readProcStat } from "../../src/core/delivery/harness-process.js";
import { type CommandHoldEntry, commandHoldMetaKey } from "../../src/core/scheduler/hold-rows.js";
import { buildSnapshot, formatStatus } from "../../src/core/status/index.js";
import { nextStep } from "../../src/core/status/next-step.js";
import type { HarnessProcess } from "../../src/core/types/index.js";
import { holdSide, mergeRepo } from "../scheduler/merge-hold-fixture.js";

/*
 * Row 011-73 (011 C6 and C9 as amended 2026-10-21; `tasks/011-61/design.md`
 * R2, test 2): during a command hold, its row written as `squeal hold`
 * (row 011-74) writes it, status names the command, its pid and its bound,
 * and says `squeal start` ends the hold; a holder whose processes are gone
 * reads `its command is gone`.
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

/** A process that ran and exited: what a holder's processes are once gone. */
async function exited(): Promise<HarnessProcess> {
  const child = spawn("sleep", ["0.2"], { stdio: "ignore" });
  if (child.pid === undefined) throw new Error("sleep did not start");
  const identity = processOf(child.pid);
  await once(child, "exit");
  return identity;
}

async function side() {
  const s = holdSide(mergeRepo());
  await s.scheduler.start();
  await s.scheduler.idle();
  return s;
}

function writeHolds(s: Awaited<ReturnType<typeof side>>, entries: CommandHoldEntry[]): void {
  s.store.meta.set(commandHoldMetaKey(s.worktreeId), JSON.stringify({ v: 1, entries }));
}

describe("status: a command hold (row 011-73)", { timeout: 60_000 }, () => {
  it("2: names the command, its pid and `until`, and that `squeal start` ends the hold", async () => {
    const s = await side();
    const since = Date.now() - 5_000;
    const until = since + 3 * 60 * 60_000;
    const child = sleeper();
    writeHolds(s, [
      {
        token: "t1",
        since,
        until,
        command: "npm run gate",
        wrapper: processOf(process.pid),
        child,
      },
    ]);
    const now = Date.now();
    const snapshot = buildSnapshot(s.store, s.root, now);
    expect(snapshot.holds).toEqual([
      { cause: "command", since, command: "npm run gate", pid: child.pid, until },
    ]);
    const text = formatStatus(snapshot, now).split("\n");
    expect(text[1]).toMatch(
      new RegExp(
        `^On hold: \`squeal hold\` since \\d\\d:\\d\\d:\\d\\d, for \`npm run gate\` \\(pid ${child.pid}\\), until it exits, at most until \\d\\d:\\d\\d:\\d\\d; edits are recorded and not run\\. \`squeal start\` ends the hold\\.$`,
      ),
    );
    const json = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(json.holds?.[0]).toMatchObject({ cause: "command", pid: child.pid, until });
  });

  it("2: a holder whose processes are gone reads `its command is gone`", async () => {
    const s = await side();
    const since = Date.now() - 5_000;
    writeHolds(s, [
      {
        token: "t1",
        since,
        until: since + 60_000,
        command: "npm run gate",
        wrapper: await exited(),
        child: await exited(),
      },
    ]);
    const now = Date.now();
    const snapshot = buildSnapshot(s.store, s.root, now);
    expect(snapshot.holds).toEqual([expect.objectContaining({ cause: "command", gone: true })]);
    expect(formatStatus(snapshot, now).split("\n")[1]).toMatch(
      /^On hold: `squeal hold` since \d\d:\d\d:\d\d, for `npm run gate` \(pid \d+\); its command is gone; the daemon ends the hold at its next heartbeat\.$/,
    );
  });

  it("2: a wrapper gone while its command runs still holds", async () => {
    const s = await side();
    const since = Date.now() - 5_000;
    writeHolds(s, [
      {
        token: "t1",
        since,
        until: since + 60_000,
        command: "npm run gate",
        wrapper: await exited(),
        child: sleeper(),
      },
    ]);
    const snapshot = buildSnapshot(s.store, s.root, Date.now());
    expect(snapshot.holds?.[0]).not.toHaveProperty("gone");
  });

  it("2: a file the command hold keeps queued reads `on hold for` the command (C15)", async () => {
    const s = await side();
    const child = sleeper();
    writeHolds(s, [
      {
        token: "t1",
        since: Date.now(),
        until: Date.now() + 60_000,
        command: "npm run gate",
        wrapper: null,
        child,
      },
    ]);
    const [hold] = buildSnapshot(s.store, s.root, Date.now()).holds ?? [];
    if (hold === undefined) throw new Error("no hold");
    const next = nextStep({ kind: "on-hold", hold });
    expect(next.reason).toBe(
      `queued, on hold for \`npm run gate\` (pid ${child.pid}) until it exits`,
    );
    expect(next.step).toEqual({ kind: "command", args: "start", text: "{command} ends the hold" });
  });
});
