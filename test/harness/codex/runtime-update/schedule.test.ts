import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CODEX_HOOKS } from "../../../../src/harness/codex/hooks.js";
import { runRuntimeHook } from "../../../../src/harness/codex/runtime-entry.js";
import { CHECK_INTERVAL_MS } from "../../../../src/harness/codex/runtime-update/index.js";
import { updateStateFile } from "../../../../src/harness/codex/runtime-update/paths.js";
import { scheduleRuntimeUpdate } from "../../../../src/harness/codex/runtime-update/schedule.js";
import { outsideGit } from "../../bundle-helpers.js";
import { runtimeTree, write } from "../adapter/fixture.js";
import { machine, SEED } from "./fixture.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): SessionStart, after the
 * adapter loaded the runtime, starts a detached update check when one is
 * due; the child names the retained runtime's CLI. No other hook schedules.
 */

/** A hook environment as the adapter gives the runtime: the retained root, the data, the adapter. */
function hookEnv() {
  const m = machine();
  const runtime = runtimeTree(join(m.data, "versions", SEED), SEED);
  const env: NodeJS.ProcessEnv = {
    PLUGIN_ROOT: runtime,
    PLUGIN_DATA: m.data,
    SQUEAL_ADAPTER_ROOT: m.plugin,
    PATH: process.env.PATH,
  };
  return { ...m, runtime, env };
}

const T0 = Date.parse("2026-10-27T12:00:00.000Z");

function checked(data: string, nextCheckAt: number): void {
  write(
    updateStateFile(data),
    `${JSON.stringify({ schema: 1, checkedAt: new Date(T0).toISOString(), nextCheckAt: new Date(nextCheckAt).toISOString(), outcome: "current", release: null, selected: SEED, failure: null, lastSuccessAt: null })}\n`,
  );
}

describe("the SessionStart runtime-update trigger (002-34)", () => {
  it("starts a background update through the retained CLI when a check is due", () => {
    const h = hookEnv();
    const start = vi.fn();
    const args = scheduleRuntimeUpdate({ env: h.env, start, now: () => T0 });
    const cli = join(h.runtime, "dist", "cli", "squeal.mjs");
    expect(args).toEqual([
      cli,
      "codex-runtime",
      "update",
      "--plugin-root",
      h.plugin,
      "--data",
      h.data,
      "--background",
    ]);
    expect(start).toHaveBeenCalledWith(process.execPath, args, h.env);
  });

  it("starts nothing before the next check, or outside a fixed plugin's adapter", () => {
    const h = hookEnv();
    const start = vi.fn();
    checked(h.data, T0 + CHECK_INTERVAL_MS);
    expect(scheduleRuntimeUpdate({ env: h.env, start, now: () => T0 + 1 })).toBeNull();
    const due = () => T0 + CHECK_INTERVAL_MS;
    // A retained runtime is no adapter: it has a plugin manifest but no hooks.json or seed.
    const retained = { ...h.env, SQUEAL_ADAPTER_ROOT: h.runtime };
    expect(scheduleRuntimeUpdate({ env: retained, start, now: due })).toBeNull();
    for (const name of ["SQUEAL_ADAPTER_ROOT", "PLUGIN_ROOT", "PLUGIN_DATA"]) {
      const env = { ...h.env, [name]: "" };
      expect(scheduleRuntimeUpdate({ env, start, now: due }), name).toBeNull();
    }
    expect(start).not.toHaveBeenCalled();
    expect(scheduleRuntimeUpdate({ env: h.env, start, now: due })).not.toBeNull();
  });

  it("runs from the runtime entry at SessionStart only, detached", async () => {
    const h = hookEnv();
    const log = join(h.data, "started.log");
    // The retained CLI is a stub that records its arguments: no updater, no network.
    write(
      join(h.runtime, "dist", "cli", "squeal.mjs"),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
    );
    const stdin = JSON.stringify({ session_id: "s-1", cwd: outsideGit(), source: "startup" });
    const write0 = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      for (const name of Object.keys(CODEX_HOOKS).filter((n) => n !== "session-start")) {
        await runRuntimeHook(name, stdin, { ...h.env });
      }
      await runRuntimeHook("session-start", stdin, { ...h.env });
    } finally {
      write0.mockRestore();
    }
    const deadline = Date.now() + 10_000;
    while (!existsSync(log) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      ["codex-runtime", "update", "--plugin-root", h.plugin, "--data", h.data, "--background"],
    ]);
  });
});
