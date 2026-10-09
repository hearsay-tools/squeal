import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkIdentity, readFlakyNotes } from "../../src/core/state/index.js";
import type { CheckId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Review wave 13i, B3 (task 001-187): a new failure whose run read a tracked
 * path its closure lacked is stored under the grown key (task 001-132) and
 * is re-run once like any other new failure (task 001-171).
 */

const GROWN = "test/grown.test.ts";
const flips: CheckId = { kind: "test", project: "", testPath: GROWN, fullName: "flips" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

describe("a new failure stored through observed growth is re-run once", SLOW, () => {
  it("reports FAIL, re-runs it forced once, and a pass is FAIL -> PASS with the flaky note", async () => {
    const repo = createRepo();
    const marker = join(tmpdir(), `squeal-001-187-${randomUUID()}`);
    markers.push(marker);
    writeFileSync(
      join(repo.main, GROWN),
      [
        'import { existsSync, readFileSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        "",
        'it("flips", () => {',
        '  readFileSync(new URL("../src/" + "math.ts", import.meta.url));',
        `  expect(existsSync(${JSON.stringify(marker)})).toBe(false);`,
        "});",
        "",
      ].join("\n"),
    );
    git(repo.main, ["add", GROWN]);
    git(repo.main, ["commit", "-qm", "grown"]);
    writeFileSync(marker, "");

    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { observe: true });
    let runs = 0;
    let reached = () => {};
    const atRerun = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.runner.beforeRun = async (files) => {
      if (!files.some((f) => f.path === GROWN)) return;
      runs += 1;
      if (runs < 2) return;
      reached();
      await held;
    };
    await h.scheduler.start();
    // Without the re-run the scheduler goes idle instead.
    const idle = h.scheduler.idle().then(() => "idle");
    expect(await Promise.race([atRerun.then(() => "re-run"), idle])).toBe("re-run");

    // The first run grew the closure: the fail is stored under the key with `src/math.ts`.
    expect(store.testFiles.get({ project: "", path: GROWN })?.closure.paths).toContain(
      "src/math.ts",
    );
    const key = h.keyOf(GROWN);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "fail" });
    expect(store.results.byKey(key, 0).find((r) => r.check.kind === "test")?.outcome).toBe("fail");
    const { delivery, consumer } = await h.consumer();

    rmSync(marker);
    release();
    await h.scheduler.idle();
    expect(h.runsOf(GROWN)).toHaveLength(2);
    expect(h.keyOf(GROWN)).toBe(key);
    expect(h.sink.stateOf(flips)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readFlakyNotes(store).get(checkIdentity(flips))).toMatchObject({
      key,
      from: "fail",
      to: "pass",
    });
    const healed = await delivery.onToolBoundary(consumer);
    expect(healed?.entries.map((e) => [e.check, e.kind])).toEqual([[flips, "fail-to-pass"]]);
  });
});
