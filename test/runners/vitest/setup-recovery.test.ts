import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KnownState } from "../../../src/core/types/index.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import {
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../scheduler/helpers.js";

/*
 * Review wave-13bp B3 and B4 (task 001-389), through the scheduler: a failed
 * start fails the run's own project and is retried only at the next
 * revision or `run --all` (D5), and a setup that ran to completion passes
 * its setup check whatever its tests then do (D6).
 */

/** A global setup that logs each call and throws while `throws(calls)` holds. */
function setupSource(calls: string, throws: string): string {
  return [
    'import { appendFileSync, readFileSync } from "node:fs";',
    "export default function setup() {",
    `  appendFileSync(${JSON.stringify(calls)}, "call\\n");`,
    `  const calls = readFileSync(${JSON.stringify(calls)}, "utf8").trim().split("\\n").length;`,
    `  if (${throws}) throw new Error("bootstrap failed");`,
    "}",
    "",
  ].join("\n");
}

/** The fixture repository with `config` and the setup; its call log lies outside the worktree. */
function setupRepo(config: string, throws: string, files: Record<string, string> = {}) {
  const repo = createRepo();
  const calls = join(repo.dir, "setup-calls.log");
  writeFileSync(join(repo.main, "setup.ts"), setupSource(calls, throws));
  writeFileSync(join(repo.main, "vitest.config.ts"), config);
  for (const [path, content] of Object.entries(files))
    writeFileSync(join(repo.main, path), content);
  const count = () =>
    existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
  return { repo, count };
}

const failing = (h: Harness): KnownState[] =>
  h.store.knownStates.list(h.worktreeId).filter((s) => s.outcome === "fail");

describe("a setup file two projects share, only the later one in the run (B3)", SLOW, () => {
  const config = [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    "    projects: [",
    '      { test: { name: "a", include: ["none/**/*.test.ts"], globalSetup: ["./setup.ts"] } },',
    '      { test: { name: "b", include: ["test/math.test.ts"], globalSetup: ["./setup.ts"] } },',
    "    ],",
    "  },",
    "});",
    "",
  ].join("\n");

  it("fails the run's project once, and starts again only at `run --all`", async () => {
    const { repo, count } = setupRepo(config, "true");
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
    // The review's probe ran five failed starts at revision 0; a second one fails here.
    let allowed = 1;
    h.runner.beforeRun = () => {
      if (h.runner.runs.length >= allowed) throw new Error("a failed start was retried at once");
    };
    await h.scheduler.start();
    await h.scheduler.idle();

    expect(count()).toBe(1);
    expect(h.runner.runs.map((r) => r.report.startupFailure?.projects)).toEqual([["b"]]);
    const check = { kind: "setup", project: "b", testPath: "setup.ts" } as const;
    expect(failing(h).map((s) => s.check)).toEqual([check]);

    allowed = 2;
    await h.scheduler.requestFullSuite({});
    await h.scheduler.idle();
    expect(count()).toBe(2);
    expect(h.runner.runs).toHaveLength(2);
    expect(failing(h).map((s) => s.check)).toEqual([check]);
  });
});

describe("a recovered setup whose test then times out (B4)", SLOW, () => {
  const config = [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    '  test: { include: ["test/hang.test.ts"], testTimeout: 60_000, globalSetup: ["./setup.ts"] },',
    "});",
    "",
  ].join("\n");
  const hang = [
    'import { test } from "vitest";',
    'test("hangs", () => new Promise(() => {}));',
    "",
  ].join("\n");

  it("passes its setup check once, with no setup failure left", async () => {
    const { repo, count } = setupRepo(config, "calls === 1", { "test/hang.test.ts": hang });
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      timeoutMs: 5_000,
      policy: RUN_MISSING,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const check = { kind: "setup", project: "", testPath: "setup.ts" } as const;
    expect(failing(h).map((s) => s.check)).toEqual([check]);

    await h.scheduler.requestFullSuite({});
    await h.scheduler.idle();
    expect(count()).toBeGreaterThanOrEqual(2);
    const retry = h.runner.runs[1]?.report;
    expect(retry?.end).toBe("timed-out");
    expect(retry?.completedFiles).toEqual([]);
    expect(retry?.startupFailure).toBeUndefined();
    expect(failing(h)).toEqual([]);
    expect(store.transitions.history(h.worktreeId, check).map((t) => [t.from, t.to])).toEqual([
      [null, "fail"],
      ["fail", "pass"],
    ]);
  });
});
