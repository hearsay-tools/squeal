import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { publishRuntime, selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import type { ReleaseTransport } from "../../../../src/harness/codex/runtime-release/index.js";
import {
  acquireLock,
  CHECK_INTERVAL_MS,
  FAILURE_RETRY_MS,
  lockFile,
  readUpdateState,
  STALE_LOCK_MS,
  TRANSIENT_RETRY_MS,
  updateRuntime,
} from "../../../../src/harness/codex/runtime-update/index.js";
import { runtimeTree } from "../runtime-release/fixture.js";
import { answer, LATER, machine, NEXT, release, SEED, server } from "./fixture.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): never a downgrade, the
 * persisted retry delays (one hour after a check, five minutes after a
 * transient failure, one hour after any other), which an explicit update
 * ignores, and one deadline for lock wait, network and publication admission.
 */

const T0 = Date.parse("2026-10-27T12:00:00.000Z");
const MIN = 60_000;
const artifacts = (urls: readonly string[]) => urls.filter((u) => u.endsWith(".json.gz")).length;

describe("a runtime update never downgrades (002-34)", () => {
  it("keeps a newer current runtime when the latest release or a named tag is older", async () => {
    const m = machine();
    const s = server(release(SEED), release(NEXT));
    const options = { pluginRoot: m.plugin, data: m.data, explicit: true, transport: s.transport };
    expect(await updateRuntime(options)).toMatchObject({ outcome: "updated", version: NEXT });
    s.latest = release(SEED);
    s.requests.length = 0;
    expect(await updateRuntime(options)).toMatchObject({
      outcome: "current",
      version: NEXT,
      release: "squeal--v0.1.900",
    });
    expect(await updateRuntime({ ...options, tag: "squeal--v0.1.900" })).toMatchObject({
      outcome: "current",
      version: NEXT,
    });
    expect(artifacts(s.requests)).toBe(0);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
  });

  it("downloads nothing when the seed is newer than the latest release", async () => {
    const m = machine(LATER);
    const s = server(release(NEXT));
    const r = await updateRuntime({ pluginRoot: m.plugin, data: m.data, transport: s.transport });
    expect(r).toMatchObject({ outcome: "current", version: LATER });
    expect(artifacts(s.requests)).toBe(0);
    expect(existsSync(join(m.data, "versions", NEXT))).toBe(false);
  });

  it("selects a newer release already retained without downloading it", async () => {
    const m = machine();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s-1" });
    publishRuntime({ sourceRoot: runtimeTree(NEXT), data: m.data });
    const s = server(release(NEXT));
    const r = await updateRuntime({ pluginRoot: m.plugin, data: m.data, transport: s.transport });
    expect(r).toMatchObject({ outcome: "updated", version: NEXT, previous: SEED });
    expect(artifacts(s.requests)).toBe(0);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
  });
});

describe("runtime update timing (002-34)", () => {
  /** An update at `at` minutes after T0. */
  const at = (m: ReturnType<typeof machine>, transport: ReleaseTransport, minutes: number) =>
    updateRuntime({
      pluginRoot: m.plugin,
      data: m.data,
      transport,
      now: () => T0 + minutes * MIN,
    });

  it("checks again an hour after a successful check, and an explicit update at once", async () => {
    const m = machine();
    const s = server(release(NEXT));
    expect(await at(m, s.transport, 0)).toMatchObject({ outcome: "updated" });
    expect(readUpdateState(m.data)).toMatchObject({
      outcome: "updated",
      release: "squeal--v0.1.901",
      selected: NEXT,
      failure: null,
      checkedAt: new Date(T0).toISOString(),
      nextCheckAt: new Date(T0 + CHECK_INTERVAL_MS).toISOString(),
      lastSuccessAt: new Date(T0).toISOString(),
    });
    s.requests.length = 0;
    expect(await at(m, s.transport, 59)).toMatchObject({
      outcome: "not-due",
      version: NEXT,
      nextCheckAt: new Date(T0 + CHECK_INTERVAL_MS).toISOString(),
    });
    expect(s.requests).toEqual([]);
    const explicit = await updateRuntime({
      pluginRoot: m.plugin,
      data: m.data,
      transport: s.transport,
      explicit: true,
      now: () => T0 + 59 * MIN,
    });
    expect(explicit).toMatchObject({ outcome: "current", version: NEXT });
    expect(await at(m, s.transport, 120)).toMatchObject({ outcome: "current" });
  });

  it("retries a transient failure after five minutes and keeps the last success", async () => {
    const m = machine();
    const s = server(release(NEXT));
    await at(m, s.transport, 0);
    const unavailable: ReleaseTransport = async () => answer(503, null);
    const failed = await at(m, unavailable, 60);
    expect(failed).toMatchObject({
      outcome: "failed",
      version: NEXT,
      failure: { code: "http", transient: true },
      nextCheckAt: new Date(T0 + 60 * MIN + TRANSIENT_RETRY_MS).toISOString(),
    });
    expect(readUpdateState(m.data)).toMatchObject({
      selected: NEXT,
      lastSuccessAt: new Date(T0).toISOString(),
    });
    expect(await at(m, unavailable, 64)).toMatchObject({ outcome: "not-due" });
    expect(await at(m, s.transport, 65)).toMatchObject({ outcome: "current", version: NEXT });
  });

  it("waits an hour after a release that fails validation", async () => {
    const m = machine();
    const s = server(release(NEXT));
    s.artifact = async () => answer(200, Buffer.from("not an artifact"));
    expect(await at(m, s.transport, 0)).toMatchObject({
      outcome: "failed",
      version: SEED,
      release: "squeal--v0.1.901",
      failure: { code: "integrity", transient: false },
      nextCheckAt: new Date(T0 + FAILURE_RETRY_MS).toISOString(),
    });
    expect(await at(m, s.transport, 59)).toMatchObject({ outcome: "not-due" });
    expect(readCurrent(m.data)).toEqual(null);
  });

  it("times out a stalled download using the update deadline", async () => {
    const m = machine();
    const s = server(release(NEXT));
    s.artifact = () => new Promise(() => undefined);
    const started = performance.now();
    const r = await updateRuntime({
      pluginRoot: m.plugin,
      data: m.data,
      transport: s.transport,
      timeoutMs: 300,
    });
    expect(r).toMatchObject({ outcome: "failed", failure: { code: "timeout", transient: true } });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(existsSync(lockFile(m.data))).toBe(false);
  });

  it("waits a bounded time for a live updater, without evicting it by age", async () => {
    const m = machine();
    const s = server(release(NEXT));
    const owner = await acquireLock(m.data, { now: () => Date.now() - STALE_LOCK_MS - 1 });
    expect(owner).toHaveProperty("lock");
    if (!("lock" in owner)) return;
    try {
      const started = performance.now();
      const busy = await updateRuntime({
        pluginRoot: m.plugin,
        data: m.data,
        transport: s.transport,
        lockWaitMs: 300,
      });
      const waited = performance.now() - started;
      expect(busy).toMatchObject({ outcome: "busy", owner: process.pid, version: SEED });
      expect(waited).toBeGreaterThanOrEqual(290);
      expect(waited).toBeLessThan(5_000);
      expect(s.requests).toEqual([]);
    } finally {
      owner.lock.release();
    }
    expect(
      await updateRuntime({ pluginRoot: m.plugin, data: m.data, transport: s.transport }),
    ).toMatchObject({ outcome: "updated", version: NEXT });
  });
});
