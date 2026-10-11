import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunReport } from "../../../src/core/types/index.js";
import { openFixture, outcomes, ref, SLOW } from "./helpers.js";

/*
 * Review wave-13af B2 (001-272): task 001-264's mid-run invalidate, with the
 * reverted bytes read through a virtual module whose plugin declares
 * `src/mod.ts` (`addWatchFile`). The invalidate drops the virtual module's
 * transform while those bytes are still on disk; the file is restored before
 * the run ends, and the run's own check must still see what it read.
 */

const NEW = 'export const which = "new";\n';
const OLD = 'export const which = "old";\n';
const HELD = ref("test/held.test.ts");

const markerDirs: string[] = [];
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CONFIG = [
  'import { readFileSync } from "node:fs";',
  'import { resolve } from "node:path";',
  'import { defineConfig } from "vitest/config";',
  "export default defineConfig({",
  '  plugins: [{ name: "virtual-which", resolveId: (id) => (id === "virtual:which" ? "\\0virtual:which" : null), load(id) { if (id !== "\\0virtual:which") return null; const file = resolve(import.meta.dirname, "src/mod.ts"); this.addWatchFile(file); return readFileSync(file, "utf8"); } }],',
  '  test: { include: ["test/*.test.ts"] },',
  "});",
  "",
].join("\n");

/**
 * Reverts `src/mod.ts`, past the stat's racy window, loads it through
 * `virtual:which`, writes `loaded`, waits for `go`, then restores it if
 * `restore`, and expects the restored bytes.
 */
function heldTest(loaded: string, go: string, restore: boolean): string {
  return [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'it("loads the virtual module while its input is reverted", async () => {',
    '  const file = new URL("../src/mod.ts", import.meta.url);',
    '  const restored = readFileSync(file, "utf8");',
    `  writeFileSync(file, ${JSON.stringify(OLD)});`,
    "  await delay(2_500);",
    '  const { which } = await import("virtual:which");',
    `  writeFileSync(${JSON.stringify(loaded)}, "");`,
    `  while (!existsSync(${JSON.stringify(go)})) await delay(20);`,
    restore ? "  writeFileSync(file, restored);" : "",
    '  expect(which).toBe("new");',
    "}, 120_000);",
    "",
  ].join("\n");
}

/** A run of the held file, `invalidate` of `src/mod.ts` landing after the load when `invalidate`. */
async function heldRun(options: { invalidate: boolean; restore: boolean }): Promise<RunReport> {
  const markers = mkdtempSync(join(tmpdir(), "squeal-001-272-"));
  markerDirs.push(markers);
  const loaded = join(markers, "loaded");
  const go = join(markers, "go");
  const fx = await openFixture("basic", {
    "vitest.config.ts": CONFIG,
    "src/mod.ts": NEW,
    [HELD.path]: heldTest(loaded, go, options.restore),
  });
  const run = fx.adapter.run([HELD], fx.runOptions());
  await expect.poll(() => existsSync(loaded), { timeout: 60_000 }).toBe(true);
  if (options.invalidate) await fx.adapter.invalidate([{ path: "src/mod.ts", kind: "change" }]);
  writeFileSync(go, "");
  return run;
}

describe("vitest adapter: a virtual input under a mid-run invalidate (wave-13af B2)", SLOW, () => {
  it("drops the run when its declared input is restored after the invalidate", async () => {
    const report = await heldRun({ invalidate: true, restore: true });
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.failure).toContain("src/mod.ts changed on disk after this run loaded it");
  });

  it("drops it the same way with no invalidate", async () => {
    const report = await heldRun({ invalidate: false, restore: true });
    expect(report.completedFiles).toEqual([]);
    expect(report.results).toEqual([]);
    expect(report.failure).toContain("src/mod.ts changed on disk after this run loaded it");
  });

  it("keeps the failure the old bytes on disk earned when nothing is restored", async () => {
    const report = await heldRun({ invalidate: true, restore: false });
    expect(report.completedFiles).toEqual([HELD]);
    expect(outcomes(report)).toEqual(["fail"]);
    expect(report.failure).toBeNull();
  });
});
