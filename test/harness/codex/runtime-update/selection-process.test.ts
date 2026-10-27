import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pinFile, readCurrent } from "../../../../src/harness/codex/adapter/layout.js";
import { publishRuntime, selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import { write } from "../adapter/fixture.js";
import { runtimeTree } from "../runtime-release/fixture.js";
import { LATER, machine, NEXT, release, SEED } from "./fixture.js";

function probe(mode: string, m: ReturnType<typeof machine>, phase: string, nextPlugin = m.plugin) {
  const r = release(NEXT);
  write(join(m.data, "descriptor.json"), r.descriptor);
  write(join(m.data, "artifact.gz"), r.artifact);
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--disable-warning=ExperimentalWarning",
        fileURLToPath(new URL("./selection-process.ts", import.meta.url)),
        mode,
        m.plugin,
        m.data,
        NEXT,
        phase,
        nextPlugin,
      ],
      { encoding: "utf8", timeout: 15_000 },
    ),
  ) as {
    triggered: boolean;
    result: { version: string; outcome?: string; source?: string };
    other: { result: { version: string; outcome?: string } };
    current: unknown;
  };
}

describe("current selection across real processes (002-38, review B1)", () => {
  for (const phase of ["new", "retained"] as const) {
    it(`concurrent adapters with a ${phase} older seed keep and pin the newer seed`, () => {
      const m = machine();
      const newer = machine(LATER);
      if (phase === "retained")
        publishRuntime({ sourceRoot: join(m.plugin, "seed"), data: m.data });
      const p = probe("bootstrap-bootstrap", m, phase, newer.plugin);
      expect(p.triggered).toBe(true);
      expect(p.other.result).toMatchObject({ version: LATER });
      expect(p.result).toMatchObject({ version: LATER });
      expect(p.current).toEqual({ schema: 1, version: LATER });
    });
  }

  for (const phase of ["new", "retained"] as const) {
    for (const initial of ["absent", "older"] as const) {
      it(`bootstrap with ${phase} seed and ${initial} current cannot undo a completed update`, () => {
        const m = machine();
        if (initial === "older")
          publishRuntime({ sourceRoot: runtimeTree("0.1.899"), data: m.data, select: true });
        if (phase === "retained")
          publishRuntime({ sourceRoot: join(m.plugin, "seed"), data: m.data });
        publishRuntime({ sourceRoot: runtimeTree(NEXT), data: m.data });
        const p = probe("bootstrap-update", m, phase);
        expect(p.triggered).toBe(true);
        expect(p.other.result).toMatchObject({ outcome: "updated", version: NEXT });
        expect(p.result).toMatchObject({ version: NEXT, source: "current" });
        expect(p.current).toEqual({ schema: 1, version: NEXT });
        expect(JSON.parse(readFileSync(pinFile(m.data, "first-session"), "utf8"))).toMatchObject({
          version: NEXT,
        });
      });
    }
  }

  for (const phase of ["retained", "staged"] as const) {
    it(`${phase} updater reads the newer bootstrap winner and preserves an old session's pin`, () => {
      const m = machine(LATER);
      // Pin an older runtime before making the newer adapter seed visible.
      const old = machine(SEED);
      selectRuntime({ pluginRoot: old.plugin, data: m.data, sessionId: "running" });
      const pin = readFileSync(pinFile(m.data, "running"), "utf8");
      if (phase === "retained") publishRuntime({ sourceRoot: runtimeTree(NEXT), data: m.data });
      // The updater starts against the old seed; a new adapter is made visible at the pause.
      const p = probe("update-bootstrap", { ...m, plugin: old.plugin }, phase, m.plugin);
      expect(p.triggered).toBe(true);
      expect(p.result).toMatchObject({ outcome: "current", version: LATER });
      expect(readCurrent(m.data)).toEqual({ schema: 1, version: LATER });
      expect(readFileSync(pinFile(m.data, "running"), "utf8")).toBe(pin);
    });
  }
});
