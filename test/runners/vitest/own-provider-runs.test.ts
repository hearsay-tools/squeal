import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COVERAGE_PROVIDER_VERSION,
  createCoverageWriter,
  decodeRecord,
} from "../../../src/core/code/coverage/index.js";
import type { CancelCause } from "../../../src/core/types/index.js";
import type * as Broken from "../../../src/runners/vitest/broken.js";
import type * as Run from "../../../src/runners/vitest/run.js";
import { commonDir, ON, open } from "../../code/helpers.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 015 D8 as corrected 2026-10-24 (review 0.1.295 B3): a test file that
 * completed whole before a cancellation keeps its record, as it keeps its
 * result; the file the cancellation stopped leaves none. A hung, crashed or
 * rejected run leaves no record, and every payload its workers wrote is
 * deleted.
 */

/**
 * The run's own execution, then marked as the case needs: a real run whose
 * files completed and whose workers wrote payloads, judged hung, crashed
 * (a runner failure) or rejected, which no fixture makes on demand.
 */
const forced = vi.hoisted(() => ({ as: null as "hung" | "crashed" | "rejected" | null }));

vi.mock("../../../src/runners/vitest/run.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Run>();
  const execute: typeof actual.execute = async (...args) => {
    const execution = await actual.execute(...args);
    if (forced.as === "hung") return { ...execution, failure: "workers did not stop", hung: true };
    if (forced.as === "rejected") {
      const error = new Error("forced rejection");
      return { ...execution, end: "crashed", failure: String(error), rejected: { error } };
    }
    return execution;
  };
  return { ...actual, execute };
});

vi.mock("../../../src/runners/vitest/broken.js", async (importOriginal) => {
  const actual = await importOriginal<typeof Broken>();
  const runnerFailure: typeof actual.runnerFailure = (...args) =>
    forced.as === "crashed" ? "Error: forced runner failure" : actual.runnerFailure(...args);
  return { ...actual, runnerFailure };
});

const markers: string[] = [];
afterEach(() => {
  forced.as = null;
  for (const dir of markers.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HELD = "test/held.test.ts";

/** A test file whose first test waits while `hold` exists, then a second test. */
function heldFile(started: string, hold: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { add } from "../src/math.js";',
    'it("holds", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    "  expect(add(1, 1)).toBe(2);",
    "}, 60_000);",
    'it("after the hold", () => expect(add(2, 2)).toBe(4));',
    "",
  ].join("\n");
}

describe("vitest adapter: which runs leave a coverage record (review 0.1.295 B3)", SLOW, () => {
  it("a file that completed before a cancel keeps its record; the file the cancel stopped leaves none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sq-own-provider-cancel-"));
    markers.push(dir);
    const started = join(dir, "started");
    const hold = join(dir, "hold");
    writeFileSync(hold, "");
    const store = commonDir();
    // Every result of this run is stored, as the scheduler stores a completed file's;
    // so only the adapter can keep the stopped file's record out.
    const writer = createCoverageWriter({
      commonDir: store,
      format: "sha1",
      policy: () => ON,
      resultKey: (runId, testFile) => (runId === "r1" ? `key:${testFile.path}` : undefined),
      log: () => {},
      waitsMs: [0],
    });
    const opened = covering({ collected: writer.collected });
    const fx = await openFixture(
      "own-provider",
      { [HELD]: heldFile(started, hold) },
      opened.create,
    );
    const controller = new AbortController();
    const ended: string[] = [];
    const running = fx.adapter.run(
      [ref("test/math.test.ts"), ref(HELD)],
      fx.runOptions({
        runId: "r1",
        signal: controller.signal,
        fileEnded: (testFile) => ended.push(testFile.path),
      }),
    );
    await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => ended, { timeout: 60_000 }).toEqual(["test/math.test.ts"]);
    controller.abort("yield" satisfies CancelCause);
    rmSync(hold);
    const report = await running;
    await writer.idle();
    await writer.close();

    expect(report.failure).toMatch(/^run cancelled: it yielded/);
    expect(report.completedFiles).toEqual([ref("test/math.test.ts")]);
    expect(opened.runs.map((r) => [r.runId, r.files.map((f) => f.testFile.path)])).toEqual([
      ["r1", ["test/math.test.ts"]],
    ]);
    // Both workers wrote a payload: the completed file's was mapped, the stopped file's deleted.
    expect(opened.payloads()).toHaveLength(2);
    expect(opened.payloads().filter(existsSync)).toEqual([]);
    const recordAt = (path: string) => {
      const bytes = open(store).coverage.get({
        resultKey: `key:${path}`,
        providerVersion: COVERAGE_PROVIDER_VERSION,
      });
      return bytes === null ? null : decodeRecord(bytes).sources.map((s) => s.path);
    };
    expect(recordAt("test/math.test.ts")).toEqual(["src/math.ts", "test/math.test.ts"]);
    expect(recordAt(HELD)).toBeNull();
  });

  it.each(["hung", "crashed", "rejected"] as const)(
    "a %s run hands no payload over and deletes every payload its workers wrote",
    async (as) => {
      const opened = covering();
      const fx = await openFixture("own-provider", {}, opened.create);
      forced.as = as;
      const report = await fx.adapter.run(
        [ref("test/math.test.ts"), ref("test/text.test.ts")],
        fx.runOptions(),
      );
      forced.as = null;

      expect(report.failure).not.toBeNull();
      expect(opened.runs).toEqual([]);
      expect(opened.payloads()).toHaveLength(2);
      expect(opened.payloads().filter(existsSync)).toEqual([]);
    },
  );
});
