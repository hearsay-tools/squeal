import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CancelCause } from "../../../src/core/types/index.js";
import { CANCELLED, cancelled } from "../../../src/runners/vitest/run.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-56 (011-51 notes): a cancel's text said "an edit arrived during a
 * backlog tier" whatever cancelled the run; since 011-51 a cancel may be a
 * supersession or a yield of any fast tier, a stop or a step-down. The
 * scheduler aborts with its `CancelCause`; the run's failure, the run log's
 * header, and a note in its body name it.
 */

const CAUSES: readonly CancelCause[] = ["supersession", "backlog", "yield", "stop", "step-down"];

describe("a cancel's text (row 011-56)", () => {
  it("names each cause after the same prefix, each its own", () => {
    const texts = CAUSES.map(cancelled);
    for (const text of texts) expect(text.startsWith(`${CANCELLED}: `)).toBe(true);
    expect(new Set(texts).size).toBe(CAUSES.length);
    expect(cancelled("backlog")).toBe(`${CANCELLED}: an edit arrived during a backlog tier`);
    expect(cancelled("stop")).toBe(`${CANCELLED}: squeal stop`);
  });

  it("is neutral for a cancel with no cause it knows, never the backlog's", () => {
    for (const reason of [undefined, new DOMException("aborted", "AbortError"), "toString"]) {
      expect(cancelled(reason)).toBe(CANCELLED);
    }
  });
});

const HELD = "test/held.test.ts";

const markerDirs: string[] = [];
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("vitest adapter: a cancelled run names its cause (row 011-56)", SLOW, () => {
  it("in its failure, its log's header and a note in the log", async () => {
    const markers = mkdtempSync(join(tmpdir(), "squeal-011-56-"));
    markerDirs.push(markers);
    const started = join(markers, "started");
    const fx = await openFixture("basic", {
      [HELD]: [
        'import { writeFileSync } from "node:fs";',
        'import { it } from "vitest";',
        'it("waits", async () => {',
        `  writeFileSync(${JSON.stringify(started)}, "");`,
        "  await new Promise((resolve) => setTimeout(resolve, 60_000));",
        "}, 120_000);",
        "",
      ].join("\n"),
    });
    await fx.adapter.invalidate([{ path: HELD, kind: "add" }]);
    const controller = new AbortController();
    const ended: string[] = [];
    const options = fx.runOptions({
      signal: controller.signal,
      fileEnded: (testFile) => ended.push(testFile.path),
    });

    const running = fx.adapter.run([ref("test/strings.test.ts"), ref(HELD)], options);
    await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => ended, { timeout: 60_000 }).toEqual(["test/strings.test.ts"]);
    controller.abort("yield" satisfies CancelCause);
    const report = await running;

    expect(report.failure).toBe(cancelled("yield"));
    expect(report.completedFiles).toEqual([ref("test/strings.test.ts")]);
    const log = readFileSync(join(options.logDir, "vitest.log"), "utf8").split("\n");
    expect(log[1]).toContain(`end: completed (${cancelled("yield")})`);
    expect(log).toContain(`squeal: ${cancelled("yield")}`);
  });

  it("when the signal was aborted before the run started, for each cause and none (review 0.1.239 B2)", async () => {
    const fx = await openFixture("basic");
    for (const reason of [...CAUSES, undefined]) {
      const controller = new AbortController();
      controller.abort(reason);
      const options = fx.runOptions({ signal: controller.signal });

      const report = await fx.adapter.run([ref("test/strings.test.ts")], options);

      const text = cancelled(controller.signal.reason);
      expect(text).toBe(reason === undefined ? CANCELLED : cancelled(reason));
      expect(report.failure).toBe(text);
      expect(report.completedFiles).toEqual([]);
      expect(report.results).toEqual([]);
      const log = readFileSync(join(options.logDir, "vitest.log"), "utf8").split("\n");
      expect(log[1]).toContain(`end: completed (${text})`);
      expect(log).toContain(`squeal: ${text}`);
    }
  });
});
