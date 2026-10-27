import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import {
  lockFile,
  readUpdateState,
  stagingDir,
  updateRuntime,
} from "../../../../src/harness/codex/runtime-update/index.js";
import {
  deadPid,
  droppedAfterHalf,
  gated,
  machine,
  NEXT,
  release,
  SEED,
  server,
} from "./fixture.js";

/*
 * Row 002-34 (spec 002 D8 and D9): an update that is interrupted, killed or
 * raced never changes the runtime new sessions select until a complete
 * runtime is published, and never changes a session's pin.
 */

/** A machine whose session `s-1` is pinned to the seed, the current runtime. */
function pinned() {
  const m = machine();
  const first = selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s-1" });
  expect(first).toMatchObject({ version: SEED, source: "seed" });
  return m;
}

const sessionRuntime = (m: ReturnType<typeof machine>, sessionId: string) =>
  selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId });

describe("an interrupted, killed or raced runtime update (002-34)", () => {
  it("keeps the current runtime and every pin when the download drops", async () => {
    const m = pinned();
    const next = release(NEXT);
    const s = server(next);
    s.artifact = droppedAfterHalf(next);
    const result = await updateRuntime({
      pluginRoot: m.plugin,
      data: m.data,
      explicit: true,
      transport: s.transport,
    });
    expect(result).toMatchObject({
      outcome: "failed",
      version: SEED,
      failure: { code: "network", transient: true },
    });
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
    expect(existsSync(join(m.data, "versions", NEXT))).toBe(false);
    expect(sessionRuntime(m, "s-1")).toMatchObject({ version: SEED, source: "pin" });
    // A network failure writes nothing to stage (row 002-30).
    expect(existsSync(stagingDir(m.data)) ? readdirSync(stagingDir(m.data)) : []).toEqual([]);
    expect(existsSync(lockFile(m.data))).toBe(false);
    expect(readUpdateState(m.data)).toMatchObject({ outcome: "failed", selected: SEED });
  });

  it("cleans abandoned staging and owner metadata, then publishes for new sessions only", async () => {
    const m = pinned();
    mkdirSync(join(m.data, "runtime"), { recursive: true });
    writeFileSync(
      lockFile(m.data),
      `${JSON.stringify({ schema: 1, pid: deadPid(), startedAt: Date.now(), token: "killed" })}\n`,
    );
    const left = join(stagingDir(m.data), "squeal-runtime-AbC123");
    mkdirSync(join(left, "dist"), { recursive: true });
    writeFileSync(join(left, "dist", "half.mjs"), "// half\n");
    const s = server(release(NEXT));
    const result = await updateRuntime({
      pluginRoot: m.plugin,
      data: m.data,
      explicit: true,
      transport: s.transport,
    });
    expect(result).toMatchObject({ outcome: "updated", version: NEXT, previous: SEED });
    expect(existsSync(left)).toBe(false);
    expect(existsSync(lockFile(m.data))).toBe(false);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
    // The running session keeps its runtime; a new one takes the published one.
    expect(sessionRuntime(m, "s-1")).toMatchObject({ version: SEED, source: "pin" });
    expect(sessionRuntime(m, "s-2")).toMatchObject({ version: NEXT, source: "current" });
    expect(existsSync(join(m.data, "versions", SEED))).toBe(true);
  });

  it("answers a competing update busy at once, and the first one publishes", async () => {
    const m = pinned();
    const next = release(NEXT);
    const s = server(next);
    const gate = gated(next);
    s.artifact = gate.answer;
    const options = { pluginRoot: m.plugin, data: m.data, explicit: true, transport: s.transport };
    const first = updateRuntime(options);
    // The first holds the lock while its download waits at the gate.
    while (!s.requests.some((url) => url.endsWith(".json.gz"))) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const second = await updateRuntime(options);
    expect(second).toMatchObject({ outcome: "busy", version: SEED, owner: process.pid });
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
    gate.open();
    expect(await first).toMatchObject({ outcome: "updated", version: NEXT });
    expect(sessionRuntime(m, "s-1")).toMatchObject({ version: SEED, source: "pin" });
    expect(s.requests.filter((url) => url.endsWith(".json.gz")).length).toBe(1);
  });
});
