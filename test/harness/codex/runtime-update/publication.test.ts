import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinFile, readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { checkRoot } from "../../../../src/harness/codex/adapter/manifest.js";
import { selectCurrent } from "../../../../src/harness/codex/adapter/selection.js";
import {
  publishRuntime,
  runtimeReadiness,
  selectRuntime,
} from "../../../../src/harness/codex/adapter/store.js";
import { prepareRuntimeUpdate } from "../../../../src/harness/codex/runtime-release/index.js";
import { stagingDir } from "../../../../src/harness/codex/runtime-update/paths.js";
import { updateRuntime } from "../../../../src/harness/codex/runtime-update/update.js";
import { runtimeTree } from "../runtime-release/fixture.js";
import { machine, NEXT, release, SEED, server } from "./fixture.js";

vi.mock("../../../../src/harness/codex/runtime-release/index.js", async (original) => {
  const actual =
    await original<typeof import("../../../../src/harness/codex/runtime-release/index.js")>();
  return {
    ...actual,
    prepareRuntimeUpdate: vi.fn(actual.prepareRuntimeUpdate),
  };
});
vi.mock("../../../../src/harness/codex/adapter/manifest.js", async (original) => {
  const actual =
    await original<typeof import("../../../../src/harness/codex/adapter/manifest.js")>();
  return { ...actual, checkRoot: vi.fn(actual.checkRoot) };
});
vi.mock("../../../../src/harness/codex/adapter/store.js", async (original) => {
  const actual = await original<typeof import("../../../../src/harness/codex/adapter/store.js")>();
  return {
    ...actual,
    publishRuntime: vi.fn(actual.publishRuntime),
    runtimeReadiness: vi.fn(actual.runtimeReadiness),
  };
});
afterEach(() => vi.restoreAllMocks());

describe("publication admission (002-37)", () => {
  for (const retained of [false, true]) {
    for (const code of ["aborted", "timeout"] as const) {
      it(`checks ${code} under selection exclusion after ${retained ? "retained" : "staged"} publication`, async () => {
        const m = machine();
        selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" });
        const pin = readFileSync(pinFile(m.data, "running"), "utf8");
        if (retained) publishRuntime({ sourceRoot: runtimeTree(NEXT), data: m.data });
        const abort = new AbortController();
        let clock = 0;
        vi.spyOn(performance, "now").mockImplementation(() => clock);
        const actual = await vi.importActual<
          typeof import("../../../../src/harness/codex/adapter/store.js")
        >("../../../../src/harness/codex/adapter/store.js");
        vi.mocked(publishRuntime).mockImplementationOnce((options) =>
          actual.publishRuntime({
            ...options,
            beforeSelect: () => {
              // This callback runs only after complete retention and the locked comparison.
              expect(existsSync(join(m.data, "versions", NEXT))).toBe(true);
              if (code === "aborted") abort.abort();
              else clock = 1_001;
              options.beforeSelect?.();
            },
          }),
        );
        const s = server(release(NEXT));
        expect(
          await updateRuntime({
            pluginRoot: m.plugin,
            data: m.data,
            signal: abort.signal,
            timeoutMs: 1_000,
            transport: s.transport,
          }),
        ).toMatchObject({ outcome: "failed", version: SEED, failure: { code } });
        expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
        expect(readFileSync(pinFile(m.data, "running"), "utf8")).toBe(pin);
        expect(existsSync(stagingDir(m.data)) ? readdirSync(stagingDir(m.data)) : []).toEqual([]);
        // A failed admission releases selection exclusion for the next contact.
        expect(selectCurrent(m.data, SEED).version).toBe(SEED);
      });
    }
  }

  it("allows synchronous publication to finish after its admission deadline", async () => {
    const m = machine();
    selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" });
    const s = server(release(NEXT));
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const actual = await vi.importActual<
      typeof import("../../../../src/harness/codex/adapter/store.js")
    >("../../../../src/harness/codex/adapter/store.js");
    vi.mocked(publishRuntime).mockImplementationOnce((options) => {
      return actual.publishRuntime({
        ...options,
        beforeSelect: () => {
          options.beforeSelect?.();
          // Selection was admitted under exclusion. Sync I/O cannot yield to a timer.
          clock = 1_001;
        },
      });
    });
    expect(
      await updateRuntime({
        pluginRoot: m.plugin,
        data: m.data,
        transport: s.transport,
        timeoutMs: 1_000,
      }),
    ).toMatchObject({ outcome: "updated", version: NEXT });
    expect(clock).toBeGreaterThan(1_000);
    expect(readCurrent(m.data)).toEqual({ schema: 1, version: NEXT });
    expect(
      selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" }),
    ).toMatchObject({
      version: SEED,
      source: "pin",
    });
  });

  for (const phase of ["staging", "retained verification", "selection recheck"] as const) {
    for (const code of ["aborted", "timeout"] as const) {
      it(`keeps current and pins when ${phase} is ${code}`, async () => {
        const retained = phase === "retained verification";
        const m = machine();
        selectRuntime({ pluginRoot: m.plugin, data: m.data, sessionId: "running" });
        const pin = readFileSync(pinFile(m.data, "running"), "utf8");
        if (retained) publishRuntime({ sourceRoot: runtimeTree(NEXT), data: m.data });
        const s = server(release(NEXT));
        const abort = new AbortController();
        let clock = 0;
        vi.spyOn(performance, "now").mockImplementation(() => clock);
        const stop = () => {
          if (code === "aborted") abort.abort();
          else clock = 1_001;
        };
        const actual = await vi.importActual<
          typeof import("../../../../src/harness/codex/runtime-release/index.js")
        >("../../../../src/harness/codex/runtime-release/index.js");
        if (retained) {
          const manifest = await vi.importActual<
            typeof import("../../../../src/harness/codex/adapter/manifest.js")
          >("../../../../src/harness/codex/adapter/manifest.js");
          vi.mocked(checkRoot).mockImplementation((...args) => {
            const checked = manifest.checkRoot(...args);
            if (args[0] === join(m.data, "versions", NEXT)) stop();
            return checked;
          });
        } else {
          const store = await vi.importActual<
            typeof import("../../../../src/harness/codex/adapter/store.js")
          >("../../../../src/harness/codex/adapter/store.js");
          vi.mocked(prepareRuntimeUpdate).mockImplementationOnce(async (options) => {
            const result = await actual.prepareRuntimeUpdate(options);
            expect(existsSync(result.root)).toBe(true);
            if (phase === "selection recheck") {
              vi.mocked(runtimeReadiness).mockImplementationOnce((options) => {
                const ready = store.runtimeReadiness(options);
                stop();
                return ready;
              });
            } else stop();
            return result;
          });
        }
        const result = await updateRuntime({
          pluginRoot: m.plugin,
          data: m.data,
          explicit: true,
          timeoutMs: 1_000,
          signal: abort.signal,
          transport: s.transport,
        });
        expect(result).toMatchObject({ outcome: "failed", version: SEED, failure: { code } });
        expect(readCurrent(m.data)).toEqual({ schema: 1, version: SEED });
        expect(readFileSync(pinFile(m.data, "running"), "utf8")).toBe(pin);
        expect(existsSync(join(m.data, "versions", NEXT))).toBe(retained);
        expect(existsSync(stagingDir(m.data)) ? readdirSync(stagingDir(m.data)) : []).toEqual([]);
      });
    }
  }
});
