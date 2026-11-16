import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { readGroupActivity } from "../../src/core/slow/state.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Row 011-342 (research/admission.md, difference 2): the import re-walk
 * gives way to every lane's waiting files, not only the default `slow`
 * group's (spec 004 D2, D3). A configured group's file waits for the load
 * guard while the re-walk has a chunk left: no chunk is queued until the
 * file ran.
 */

const GATE = "test/gate.test.ts";
const LATE = "test/late.test.ts";

const test = (name: string) =>
  [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/leaf.js";',
    `it("${name}", () => expect(value).toBe(1));`,
    "",
  ].join("\n");

/** A group of `LATE` at `edit` behind a load guard of 1.0 per CPU and a minute. */
const GUARDED: CheckGroup = {
  name: "late",
  runner: "vitest",
  tests: [LATE],
  at: "edit",
  limits: { deferUnderLoad: { maxLoadPerCpu: 1, maxDeferMs: 60_000 } },
};

describe("the re-walk beside a configured lane's waiting file (011-342)", SLOW, () => {
  it("queues no chunk while a configured group's file waits for the load guard", async () => {
    // A first daemon stores closures and results; its walks go, as in a store from before them.
    const repo = createRepo("basic");
    writeFileSync(join(repo.main, "src/leaf.ts"), "export const value = 1;\n");
    writeFileSync(join(repo.main, GATE), test("g"));
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 2,
      policy: { baseline: { onStart: "lookup-then-run-missing" } },
    });
    await first.scheduler.start();
    await first.quiet();
    await first.scheduler.close();
    connectionOf(store).run("DELETE FROM test_file_imports");

    // A file of the guarded group with no result: the next start queues it, and the load holds it.
    writeFileSync(join(repo.main, LATE), test("l"));
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-342-slot-"));
    onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
    let load = 10;
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 2,
      policy: { baseline: { onStart: "lookup-then-run-missing" }, checks: [GUARDED] },
      slow: { slotDir, recheckMs: 50, cpus: () => 1, load: () => [load] },
    });
    const walked: string[] = [];
    const closure = h.runner.closure.bind(h.runner);
    // The start keys the new late file with a walk of its own; the re-walk walks the rest.
    h.runner.closure = (testFile: TestFileRef) => {
      if (testFile.path !== LATE) walked.push(testFile.path);
      return closure(testFile);
    };

    await h.scheduler.start();
    await expect
      .poll(() => readGroupActivity(store, h.worktreeId, "late"), { timeout: 20_000 })
      .toEqual({ kind: "waiting", for: "load" });
    // Several of the guard's rechecks: each pump that finds nothing else may take a chunk.
    await delay(500);
    expect(walked, "the re-walk took a chunk while the late file waited").toEqual([]);

    // The load falls: the late file runs, then the re-walk walks the gate.
    load = 0;
    await expect.poll(() => walked, { timeout: 20_000 }).toContain(GATE);
  });
});
