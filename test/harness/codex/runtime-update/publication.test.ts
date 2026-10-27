import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinFile, readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { publishRuntime, selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import {
  prepareRuntimeUpdate,
  resolveRuntimeRelease,
} from "../../../../src/harness/codex/runtime-release/index.js";
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
    resolveRuntimeRelease: vi.fn(actual.resolveRuntimeRelease),
  };
});
afterEach(() => vi.restoreAllMocks());

describe("publication admission (002-37)", () => {
  for (const retained of [false, true]) {
    for (const code of ["aborted", "timeout"] as const) {
      it(`keeps current and pins when ${retained ? "retained selection" : "staging"} is ${code}`, async () => {
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
          vi.mocked(resolveRuntimeRelease).mockImplementationOnce(async (options) => {
            const result = await actual.resolveRuntimeRelease(options);
            stop();
            return result;
          });
        } else {
          vi.mocked(prepareRuntimeUpdate).mockImplementationOnce(async (options) => {
            const result = await actual.prepareRuntimeUpdate(options);
            expect(existsSync(result.root)).toBe(true);
            stop();
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
