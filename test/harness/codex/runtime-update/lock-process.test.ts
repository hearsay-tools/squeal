import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import {
  acquireLock,
  lockFile,
  stagingDir,
  updateRuntime,
} from "../../../../src/harness/codex/runtime-update/index.js";
import { machine, NEXT, release, SEED, server } from "./fixture.js";

const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }),
  );
});

const OWNER = fileURLToPath(new URL("./lock-owner.ts", import.meta.url));
const EXEC_ARGV = ["--import", import.meta.resolve("tsx"), "--disable-warning=ExperimentalWarning"];

interface Attempt {
  readonly kind: "held" | "busy";
  readonly pid: number;
}

/** A real process that holds the lock until killed, or answers busy; `held` comes after its hint. */
async function start(data: string) {
  const child = fork(OWNER, [data], {
    execArgv: EXEC_ARGV,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  children.push(child);
  const [result] = (await once(child, "message")) as [Attempt];
  return { child, result };
}

/** One attempt by a real process that keeps nothing; this process waits for it to end. */
function attemptOnce(data: string): Attempt {
  const out = execFileSync(process.execPath, [...EXEC_ARGV, OWNER, data], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 15_000,
  });
  return JSON.parse(out) as Attempt;
}

describe("process-owned updater lock (002-37)", () => {
  it("admits exactly one of three real processes; once it acknowledged, a contender names it", async () => {
    const { data } = machine();
    const contenders = await Promise.all([start(data), start(data), start(data)]);
    const held = contenders.filter(({ result }) => result.kind === "held");
    expect(held).toHaveLength(1);
    const holder = held[0]?.child.pid;
    expect(held[0]?.result.pid).toBe(holder);
    const busy = contenders.filter(({ result }) => result.kind === "busy");
    expect(busy).toHaveLength(2);
    // Row 011-279: a loser that tried before the holder wrote its hint reads an unknown owner.
    for (const { result } of busy) expect([0, holder]).toContain(result.pid);
    const after = await acquireLock(data);
    if ("lock" in after) after.lock.release();
    expect(after).toMatchObject({ busy: { pid: holder } });
  });

  it("answers a contender busy with an unknown owner before the holder writes its hint", async () => {
    const { data } = machine();
    let early: Attempt | undefined;
    // `now` runs once the holder is inside its exclusive transaction and before its hint.
    const held = await acquireLock(data, {
      now: () => {
        early = attemptOnce(data);
        return Date.now();
      },
    });
    try {
      expect(held).toHaveProperty("lock");
      expect(early).toEqual({ kind: "busy", pid: 0 });
      expect(attemptOnce(data)).toEqual({ kind: "busy", pid: process.pid });
    } finally {
      if ("lock" in held) held.lock.release();
    }
  }, 40_000);

  it("recovers a killed process without replacing the database, then cleans abandoned staging", async () => {
    const m = machine();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" });
    const owner = await start(m.data);
    expect(owner.result.kind).toBe("held");
    const database = `${lockFile(m.data)}.sqlite`;
    const identity = statSync(database);
    const abandoned = join(stagingDir(m.data), "squeal-runtime-killed");
    mkdirSync(abandoned, { recursive: true });
    writeFileSync(join(abandoned, "incomplete"), "half");
    const busy = await acquireLock(m.data);
    if ("lock" in busy) busy.lock.release();
    expect(busy).toMatchObject({ busy: { pid: owner.child.pid } });
    const exited = once(owner.child, "exit");
    owner.child.kill("SIGKILL");
    await exited;
    const s = server(release(NEXT));
    expect(
      await updateRuntime({ pluginRoot: m.plugin, data: m.data, transport: s.transport }),
    ).toMatchObject({ outcome: "updated", version: NEXT });
    const after = statSync(database);
    expect([after.dev, after.ino]).toEqual([identity.dev, identity.ino]);
    expect(existsSync(abandoned)).toBe(false);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
    expect(
      selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" }),
    ).toMatchObject({
      version: SEED,
      source: "pin",
    });
  });
});
