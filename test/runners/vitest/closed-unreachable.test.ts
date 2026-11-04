import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import type { Reporter, Vitest } from "vitest/node";
import { exposeGc, type GcFunction } from "../../../src/core/daemon/idle-gc.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { createSquealReporter } from "../../../src/runners/vitest/reporter.js";
import { SLOW } from "./helpers.js";

/*
 * Row 019-19 (`tasks/019-12/notes.md`): Rolldown's native global handles keep
 * every closed instance's resolved config, and through its `test.reporters`
 * Squeal's reporter. The fixture's plugin keeps each resolved config the same
 * way, so the test does not depend on that leak staying upstream.
 */
const KEPT = "__squeal019_19Kept";
const CONFIG = [
  'import { defineConfig } from "vitest/config";',
  "export default defineConfig({",
  "  plugins: [",
  `    { name: "keep", configResolved(config) { (globalThis.${KEPT} ??= []).push(config); } },`,
  "  ],",
  '  test: { include: ["test/**/*.test.ts"] },',
  "});",
  "",
].join("\n");

const fixturesDir = resolve(import.meta.dirname, "../../fixtures/vitest");
const kept = (): unknown[] => (Reflect.get(globalThis, KEPT) as unknown[] | undefined) ?? [];
const roots: string[] = [];

afterEach(() => {
  Reflect.deleteProperty(globalThis, KEPT);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("a closed adapter is unreachable while its instance's config stays held", SLOW, async () => {
  const gc = exposeGc();
  if (gc === null) throw new Error("no gc in this process");
  const root = join(fixturesDir, ".tmp", `closed-unreachable-${randomUUID()}`);
  roots.push(root);
  mkdirSync(join(fixturesDir, ".tmp"), { recursive: true });
  cpSync(join(fixturesDir, "basic"), root, { recursive: true });
  writeFileSync(join(root, "vitest.config.ts"), CONFIG);

  const adapter = await runAndClose(root);
  await collect(gc);

  expect(kept().length).toBeGreaterThan(0);
  expect(adapter.deref()).toBeUndefined();
});

it("the reporter lets go of its instance when the instance closes", async () => {
  const gc = exposeGc();
  if (gc === null) throw new Error("no gc in this process");
  const reporter = createSquealReporter(() => null);
  const instance = initClosed(reporter);
  await collect(gc);

  expect(instance.deref()).toBeUndefined();
});

/** A stand-in instance the reporter is given, then closed; only a weak reference stays. */
function initClosed(reporter: Reporter): WeakRef<object> {
  const closing: (() => void)[] = [];
  const instance = { onClose: (fn: () => void) => closing.push(fn) };
  reporter.onInit?.(instance as unknown as Vitest);
  for (const fn of closing) fn();
  return new WeakRef(instance);
}

/** Opens an adapter on `root`, runs one file, closes it, and keeps only a weak reference. */
async function runAndClose(root: string): Promise<WeakRef<object>> {
  const adapter = await createVitestAdapter({ root });
  const report = await adapter.run([{ project: "", path: "test/math.test.ts" }], {
    runId: randomUUID(),
    logDir: join(root, ".squeal-logs"),
    timeoutMs: null,
  });
  expect(report.results.length).toBeGreaterThan(0);
  await adapter.close();
  return new WeakRef(adapter);
}

/** Full GCs, each in a later task, so no `WeakRef` made in this job keeps its target. */
async function collect(gc: GcFunction): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await sleep(10);
    gc({ type: "major", execution: "sync", flavor: "last-resort" });
  }
}
