import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runAdapterHook } from "../../../../src/harness/codex/adapter/index.js";
import { pinFile, readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { selectCurrent, selectionFile } from "../../../../src/harness/codex/adapter/selection.js";
import { publishRuntime, selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import { updateRuntime } from "../../../../src/harness/codex/runtime-update/update.js";
import { answer, gated, machine, NEXT, release, SEED, server } from "../runtime-update/fixture.js";
import { runtimeTree, write } from "./fixture.js";

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

async function hold(data: string): Promise<ChildProcess> {
  const child = fork(fileURLToPath(new URL("./selection-owner.ts", import.meta.url)), [data], {
    execArgv: ["--import", import.meta.resolve("tsx"), "--disable-warning=ExperimentalWarning"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  children.push(child);
  expect((await once(child, "message"))[0]).toBe("held");
  return child;
}

describe("short current selection transaction (002-38)", () => {
  it("returns the actual winner on selected publication, retaining older trees without a downgrade", () => {
    const m = machine();
    const newer = runtimeTree(join(m.plugin, "next"), NEXT);
    const winner = publishRuntime({ sourceRoot: newer, data: m.data, select: true });
    expect(
      publishRuntime({ sourceRoot: join(m.plugin, "seed"), data: m.data, select: true }),
    ).toEqual(winner);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
    expect(existsSync(join(m.data, "versions", SEED))).toBe(true);
  });

  it("answers contention at once, keeps existing pins usable, and recovers process death without replacing the database", async () => {
    const m = machine();
    const options = { pluginRoot: m.plugin, data: m.data, sessionId: "running" };
    selectRuntime(options);
    const pin = readFileSync(pinFile(m.data, "running"), "utf8");
    const owner = await hold(m.data);
    const identity = statSync(selectionFile(m.data));
    try {
      // Retention and existing pins do not need current selection exclusion.
      publishRuntime({ sourceRoot: runtimeTree(join(m.plugin, "next"), NEXT), data: m.data });
      expect(selectRuntime(options)).toMatchObject({ version: SEED, source: "pin" });
      const started = performance.now();
      expect(() => selectCurrent(m.data, NEXT)).toThrow(
        expect.objectContaining({ kind: "selection-busy" }),
      );
      expect(performance.now() - started).toBeLessThan(500);
      const fresh = { ...options, sessionId: "fresh" };
      // A newer seed needs selection; contention must not create a pin.
      const newer = machine(NEXT);
      expect(() => selectRuntime({ ...fresh, pluginRoot: newer.plugin })).toThrow(
        expect.objectContaining({ kind: "selection-busy" }),
      );
      expect(existsSync(pinFile(m.data, "fresh"))).toBe(false);
      const repo = join(m.plugin, "repo");
      write(join(repo, "squeal.config.json"), "{}\n");
      let output = "";
      await runAdapterHook("session-start", {
        stdin: JSON.stringify({ session_id: "fresh", cwd: repo }),
        env: { PLUGIN_ROOT: newer.plugin, PLUGIN_DATA: m.data },
        write: (text) => {
          output += text;
        },
      });
      expect(output).toContain("validation unavailable");
      expect(output).toContain("busy");
      const s = server(release(NEXT));
      const result = await updateRuntime({
        pluginRoot: m.plugin,
        data: m.data,
        transport: s.transport,
      });
      expect(result).toMatchObject({
        outcome: "failed",
        version: SEED,
        failure: { code: "selection-busy", transient: true },
      });
      expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
      expect(readFileSync(pinFile(m.data, "running"), "utf8")).toBe(pin);
    } finally {
      const exited = once(owner, "exit");
      owner.kill("SIGKILL");
      await exited;
    }
    expect(selectCurrent(m.data, NEXT).version).toBe(NEXT);
    const recovered = statSync(selectionFile(m.data));
    expect([recovered.dev, recovered.ino]).toEqual([identity.dev, identity.ino]);
  });

  it("lets a first hook select and pin while an updater holds its download lock", async () => {
    const m = machine();
    const r = release(NEXT);
    const s = server(r);
    const gate = gated(r);
    let entered = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    s.artifact = async () => {
      entered();
      return gate.answer();
    };
    const update = updateRuntime({ pluginRoot: m.plugin, data: m.data, transport: s.transport });
    try {
      await waiting;
      const started = performance.now();
      expect(
        selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "during-download" }),
      ).toMatchObject({ version: SEED });
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      gate.open();
    }
    expect(await update).toMatchObject({ outcome: "updated", version: NEXT });
    expect(
      selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "during-download" }),
    ).toMatchObject({ version: SEED, source: "pin" });
  });

  it("reports the usable winner on failure when bootstrap advances current during a failed request", async () => {
    const m = machine();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" });
    const newer = machine(NEXT);
    const result = await updateRuntime({
      pluginRoot: m.plugin,
      data: m.data,
      transport: async () => {
        selectRuntime({ pluginRoot: newer.plugin, data: m.data, sessionId: "fresh" });
        return answer(503, null);
      },
    });
    expect(result).toMatchObject({ outcome: "failed", version: NEXT });
  });
});
