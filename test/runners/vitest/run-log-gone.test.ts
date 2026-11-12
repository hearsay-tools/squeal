import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CancelCause } from "../../../src/core/types/runner.js";
import { cancelled } from "../../../src/runners/vitest/run.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 018-38 (review 018-37, next-wave input 2): a daemon killed while its
 * runner host held a run; the checkout was removed; the host then cancelled
 * the run and logged it, and a recursive mkdir made the checkout's
 * `.git/squeal/runs/<id>` again. The cancelled run's log now goes nowhere.
 */

const HELD = "test/held.test.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A held test file that writes `started` once it runs. */
const held = (started: string) =>
  [
    'import { writeFileSync } from "node:fs";',
    'import { it } from "vitest";',
    'it("waits", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    "  await new Promise((resolve) => setTimeout(resolve, 60_000));",
    "}, 120_000);",
    "",
  ].join("\n");

describe(
  "vitest adapter: a cancelled run's log after its store was removed (row 018-38)",
  SLOW,
  () => {
    it.each([
      { removed: "the whole checkout", gone: (checkout: string) => checkout },
      { removed: "the store folder", gone: (checkout: string) => join(checkout, ".git", "squeal") },
    ])("writes nothing and makes nothing again once $removed is gone", async ({ gone }) => {
      const scratch = mkdtempSync(join(tmpdir(), "squeal-018-38-"));
      dirs.push(scratch);
      const started = join(scratch, "started");
      const checkout = join(scratch, "checkout");
      mkdirSync(join(checkout, ".git", "squeal"), { recursive: true });
      const fx = await openFixture("basic", { [HELD]: held(started) });
      await fx.adapter.invalidate([{ path: HELD, kind: "add" }]);
      const controller = new AbortController();
      const runId = randomUUID();
      const options = fx.runOptions({
        runId,
        logDir: join(checkout, ".git", "squeal", "runs", runId),
        signal: controller.signal,
      });

      const running = fx.adapter.run([ref(HELD)], options);
      await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
      const removed = gone(checkout);
      rmSync(removed, { recursive: true });
      controller.abort("stop" satisfies CancelCause);
      const report = await running;

      expect(report.failure).toBe(cancelled("stop"));
      expect(existsSync(removed)).toBe(false);
    });

    it("still logs a cancelled run while its store is there", async () => {
      const scratch = mkdtempSync(join(tmpdir(), "squeal-018-38-"));
      dirs.push(scratch);
      const started = join(scratch, "started");
      const store = join(scratch, "checkout", ".git", "squeal");
      mkdirSync(store, { recursive: true });
      const fx = await openFixture("basic", { [HELD]: held(started) });
      await fx.adapter.invalidate([{ path: HELD, kind: "add" }]);
      const controller = new AbortController();
      const runId = randomUUID();
      const options = fx.runOptions({
        runId,
        logDir: join(store, "runs", runId),
        signal: controller.signal,
      });

      const running = fx.adapter.run([ref(HELD)], options);
      await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
      controller.abort("stop" satisfies CancelCause);
      await running;

      const log = readFileSync(join(options.logDir, "vitest.log"), "utf8").split("\n");
      expect(log[1]).toContain(`end: completed (${cancelled("stop")})`);
      expect(existsSync(join(options.logDir, "report.json"))).toBe(true);
    });
  },
);
