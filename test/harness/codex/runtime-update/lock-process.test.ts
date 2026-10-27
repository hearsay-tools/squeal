import { type ChildProcess, fork } from "node:child_process";
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

async function start(data: string) {
  const child = fork(fileURLToPath(new URL("./lock-owner.ts", import.meta.url)), [data], {
    execArgv: ["--import", import.meta.resolve("tsx"), "--disable-warning=ExperimentalWarning"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  children.push(child);
  const [result] = (await once(child, "message")) as [{ kind: "held" | "busy"; pid: number }];
  return { child, result };
}

describe("process-owned updater lock (002-37)", () => {
  it("admits exactly one of three real processes", async () => {
    const { data } = machine();
    const contenders = await Promise.all([start(data), start(data), start(data)]);
    const held = contenders.filter(({ result }) => result.kind === "held");
    expect(held).toHaveLength(1);
    expect(contenders.filter(({ result }) => result.kind === "busy")).toHaveLength(2);
    for (const { result } of contenders) expect(result.pid).toBe(held[0]?.child.pid);
  });

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
