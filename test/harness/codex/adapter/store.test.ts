import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentFile, pinFile } from "../../../../src/harness/codex/adapter/layout.js";
import { RuntimeError } from "../../../../src/harness/codex/adapter/manifest.js";
import {
  publishRuntime,
  releaseSession,
  runtimeReadiness,
  selectRuntime,
} from "../../../../src/harness/codex/adapter/store.js";
import { tempDir } from "../../../store/helpers.js";
import { ADAPTER_VERSION, fixedPlugin, runtimeTree, write, writeManifest } from "./fixture.js";

/*
 * Row 002-29 (spec 002 D9): selection pins a session at its first contact and
 * never switches it; readiness reports what a new session would get.
 */

const A = "0.1.900";
const B = "0.1.901";
const NODE = "22.19.0";

function setup() {
  const dir = tempDir("sq-adapter-store-");
  return {
    dir,
    data: join(dir, "data"),
    tree: (v: string, name = v) => runtimeTree(join(dir, name), v),
  };
}

/** The `RuntimeError` `run` throws. */
function failure(run: () => unknown): RuntimeError {
  try {
    run();
  } catch (error) {
    if (error instanceof RuntimeError) return error;
    throw error;
  }
  throw new Error("expected a RuntimeError");
}

describe("selectRuntime", () => {
  function machine(seed = A) {
    const s = setup();
    return { ...s, plugin: fixedPlugin(join(s.dir, "plugin"), seed) };
  }

  it("pins the current runtime at first contact; the pin outlives a change of current", () => {
    const m = machine();
    publishRuntime({ sourceRoot: m.tree(B), data: m.data, select: true, node: NODE });
    const s = { pluginRoot: m.plugin, data: m.data, sessionId: "s", node: NODE };
    expect(selectRuntime(s)).toMatchObject({ version: B, source: "current" });
    expect(selectRuntime(s)).toMatchObject({ version: B, source: "pin" });
    publishRuntime({ sourceRoot: m.tree("0.1.902"), data: m.data, select: true, node: NODE });
    expect(selectRuntime(s)).toMatchObject({ version: B, source: "pin" });
    expect(selectRuntime({ ...s, sessionId: "t" })).toMatchObject({ version: "0.1.902" });
  });

  it("selects the seed over an older current: an adapter release ships a newer seed", () => {
    const m = machine(B);
    publishRuntime({ sourceRoot: m.tree(A), data: m.data, select: true, node: NODE });
    expect(
      selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s", node: NODE }),
    ).toMatchObject({
      version: B,
      source: "seed",
    });
    expect(JSON.parse(readFileSync(currentFile(m.data), "utf8"))).toEqual({
      schema: 1,
      version: B,
    });
  });

  it("falls back to the seed when current's root is gone, without moving current", () => {
    const m = machine(A);
    publishRuntime({ sourceRoot: m.tree(B), data: m.data, select: true, node: NODE });
    rmSync(join(m.data, "versions", B), { recursive: true });
    expect(
      selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s", node: NODE }),
    ).toMatchObject({
      version: A,
      source: "seed",
    });
    expect(JSON.parse(readFileSync(currentFile(m.data), "utf8"))).toEqual({
      schema: 1,
      version: B,
    });
  });

  it("rejects a mislabeled pinned root: versions/<v> holding another runtime is missing, not used", () => {
    const m = machine();
    const s = { pluginRoot: m.plugin, data: m.data, sessionId: "s", node: NODE };
    selectRuntime(s);
    publishRuntime({ sourceRoot: m.tree(B), data: m.data, node: NODE });
    rmSync(join(m.data, "versions", A), { recursive: true });
    renameSync(join(m.data, "versions", B), join(m.data, "versions", A));
    const error = failure(() => selectRuntime(s));
    expect(error.kind).toBe("missing-pinned-runtime");
    expect(error.message).toContain(`it holds runtime ${B}, not ${A}`);
  });

  it("an unreadable pin is an invalid-pin, never a guess", () => {
    const m = machine();
    write(pinFile(m.data, "s"), "{not json");
    expect(
      failure(() =>
        selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "s", node: NODE }),
      ).kind,
    ).toBe("invalid-pin");
  });

  it("a pinned runtime whose Node floor this Node misses is unsupported-node", () => {
    const m = machine();
    const s = { pluginRoot: m.plugin, data: m.data, sessionId: "s", node: NODE };
    writeManifest(join(m.plugin, "seed"), A, "22.19");
    selectRuntime(s);
    expect(failure(() => selectRuntime({ ...s, node: "20.0.0" })).kind).toBe("unsupported-node");
  });

  it("names a session's pin by a hash, and releaseSession removes only that pin", () => {
    const m = machine();
    const id = "../../escape";
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: id, node: NODE });
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "other", node: NODE });
    const names = readdirSync(join(m.data, "runtime", "sessions"));
    expect(names.every((n) => /^[0-9a-f]{64}\.json$/.test(n))).toBe(true);
    releaseSession(m.data, id);
    expect(existsSync(pinFile(m.data, id))).toBe(false);
    expect(existsSync(pinFile(m.data, "other"))).toBe(true);
  });
});

describe("runtimeReadiness", () => {
  it("reports adapter, current, seed and pinned runtimes without writing", () => {
    const s = setup();
    const plugin = fixedPlugin(join(s.dir, "plugin"), A);
    expect(runtimeReadiness({ pluginRoot: plugin, data: s.data, node: NODE })).toEqual({
      schema: 1,
      adapter: { root: plugin, version: ADAPTER_VERSION },
      current: { version: null, ready: false, problem: "no runtime is selected" },
      seed: { version: A, ready: true, problem: null },
      pinned: [],
      ready: true,
    });
    expect(existsSync(s.data)).toBe(false);
    selectRuntime({ pluginRoot: plugin, data: s.data, sessionId: "s", node: NODE });
    rmSync(join(plugin, "seed", "bin"), { recursive: true });
    rmSync(join(s.data, "versions", A, "skills"), { recursive: true });
    const after = runtimeReadiness({ pluginRoot: plugin, data: s.data, node: NODE });
    expect(after.current).toMatchObject({ version: A, ready: false });
    expect(after.seed).toMatchObject({
      ready: false,
      problem: expect.stringContaining("bin/squeal-launcher is missing"),
    });
    expect(after.pinned).toEqual([{ version: A, ready: false }]);
    expect(after.ready).toBe(false);
  });
});
