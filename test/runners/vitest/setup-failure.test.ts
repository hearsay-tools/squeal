import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readVerdict, verdictCode } from "../../../src/cli/verdict.js";
import { formatDelta } from "../../../src/core/delivery/index.js";
import { readUnknownFiles } from "../../../src/core/scheduler/unknown-files.js";
import {
  failureCountText,
  formatCheck,
  parseCheck,
  readWhy,
} from "../../../src/core/status/index.js";
import type { KnownState } from "../../../src/core/types/index.js";
import { knownFailuresLine } from "../../../src/harness/shared/text.js";
import { RUN_MISSING } from "../../helpers/baseline.js";
import {
  ALL_TEST_FILES,
  createRepo,
  type Harness,
  openHarness,
  openRepoStore,
  SLOW,
} from "../../scheduler/helpers.js";

/*
 * Task 001-382, research cezar-e2e-setup: Vitest marks a project's
 * `globalSetup` done before running it, so an instance kept after the setup
 * threw runs every later file with no setup at all. Cezar's case: one
 * bootstrap failure became 74 stored file FAILs from a stale descriptor.
 */

const SETUP = "setup.ts";
const SETUP_CHECK = { kind: "setup", project: "", testPath: SETUP } as const;
const SUMMARY =
  "setup failed: Browser E2E environment bootstrap failed (E_BOOT); " +
  "cause: A cockpit already serves this checkout (E_OWNED)";

/** A global setup that logs each call to `calls` and throws on the first, with a cause. */
function setupSource(calls: string): string {
  return [
    'import { appendFileSync, readFileSync } from "node:fs";',
    "export default function setup() {",
    `  appendFileSync(${JSON.stringify(calls)}, "call\\n");`,
    `  if (readFileSync(${JSON.stringify(calls)}, "utf8").trim().split("\\n").length > 1) return;`,
    '  const cause = Object.assign(new Error("A cockpit already serves this checkout"), { code: "E_OWNED" });',
    '  throw Object.assign(new Error("Browser E2E environment bootstrap failed", { cause }), { code: "E_BOOT" });',
    "}",
    "",
  ].join("\n");
}

const CONFIG = [
  'import { defineConfig } from "vitest/config";',
  "",
  "export default defineConfig({",
  '  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, globalSetup: ["./setup.ts"] },',
  "});",
  "",
].join("\n");

/** The fixture repository with the throwing setup; its call log lies outside the worktree. */
function setupRepo() {
  const repo = createRepo();
  const calls = join(repo.dir, "setup-calls.log");
  writeFileSync(join(repo.main, SETUP), setupSource(calls));
  writeFileSync(join(repo.main, "vitest.config.ts"), CONFIG);
  const count = () =>
    existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
  return { repo, count };
}

const failing = (h: Harness): KnownState[] =>
  h.store.knownStates.list(h.worktreeId).filter((s) => s.outcome === "fail");

describe("a setup check's name", () => {
  it("round-trips through the one formatter, with and without a project and a file", () => {
    for (const check of [
      SETUP_CHECK,
      { kind: "setup", project: "e2e", testPath: "packages/web/e2e/environment.ts" },
      { kind: "setup", project: "e2e", testPath: "" },
    ] as const) {
      expect(parseCheck(formatCheck(check))).toEqual(check);
    }
    expect(formatCheck({ kind: "setup", project: "e2e", testPath: "" })).toBe(
      "[e2e] (global setup)",
    );
  });
});

describe("a global setup that throws once", SLOW, () => {
  it("is one known failure with its cause and no file FAIL, and the next revision runs the setup again", async () => {
    const { repo, count } = setupRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
    const { delivery, consumer } = await h.consumer();
    await h.scheduler.start();
    await h.scheduler.idle();

    // One run, rejected in the setup; no other file ran on an instance whose setup threw.
    expect(count()).toBe(1);
    expect(h.runner.runs.map((r) => r.report.end)).toEqual(["crashed"]);
    const startup = h.runner.runs[0]?.report.startupFailure;
    expect(startup?.projects).toEqual([""]);
    expect(startup?.setupFile).toBe(SETUP);
    expect(startup?.error.code).toBe("E_BOOT");
    expect(startup?.error.causes).toEqual([
      { message: "A cockpit already serves this checkout", code: "E_OWNED" },
    ]);

    // One known failure, the setup's, with its code and cause; nothing stored under a key.
    expect(failing(h).map((s) => [s.check, s.validity, s.summary])).toEqual([
      [SETUP_CHECK, "current", SUMMARY],
    ]);
    const stored = ALL_TEST_FILES.flatMap((path) => {
      const key = h.keyOf(path);
      return key === null ? [] : store.results.byKey(key);
    });
    expect(stored).toEqual([]);
    expect(failureCountText(failing(h).map((s) => s.check))).toBe("1 (1 global setup)");
    expect(knownFailuresLine(failing(h))).toBe("Known failures: 1 (setup.ts (global setup))");
    // One line delivered, naming the setup error with its code and cause; `squeal why` finds it.
    const delta = await delivery.onToolBoundary(consumer);
    const text = delta === null ? "" : formatDelta(delta);
    expect(text).toContain(`FAIL  setup.ts (global setup)\n      first observed: FAIL`);
    expect(text).toContain(SUMMARY);
    expect(text).toMatch(/^SQUEAL · 1 check changed \(1 global setup\) at revision 0\n/);
    expect(text).not.toMatch(/FAIL {2}test\//);
    const why = readWhy(repo.main, "setup.ts (global setup)");
    expect("knownState" in why ? why.knownState?.summary : why).toBe(SUMMARY);
    const blocked = readVerdict(store, h.worktreeId);
    expect(blocked.failures).toEqual({ tests: 0, testFiles: 0, setups: 1 });
    expect(blocked.byClass.unknown).toBe(ALL_TEST_FILES.length);
    expect(verdictCode(blocked)).toBe(3);
    // Row 011-27: each file it kept from running is recorded with the setup as its cause.
    const causes = [...readUnknownFiles(store, h.worktreeId).values()].map((r) => r.cause);
    expect(causes.length).toBeGreaterThan(0);
    expect(new Set(causes)).toEqual(new Set(["setup"]));

    // The next revision recreates nothing it need not: the closed instance's successor runs the setup.
    const math = join(repo.main, "src/math.ts");
    writeFileSync(math, `${readFileSync(math, "utf8")}\n// touched\n`);
    await h.batch("src/math.ts");
    await h.scheduler.idle();

    expect(count()).toBe(2);
    expect(failing(h)).toEqual([]);
    expect(store.knownStates.get(h.worktreeId, SETUP_CHECK)?.outcome).toBe("pass");
    const recovered = await delivery.onToolBoundary(consumer);
    expect(recovered === null ? "" : formatDelta(recovered)).toContain(
      "PASS  setup.ts (global setup)",
    );
    const settled = readVerdict(store, h.worktreeId);
    expect(settled.byClass.current).toBe(ALL_TEST_FILES.length);
    expect(verdictCode(settled)).toBe(0);
  });

  it("runs the setup again at `run --all` with no edit", async () => {
    const { repo, count } = setupRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(failing(h).map((s) => s.check)).toEqual([SETUP_CHECK]);

    await h.scheduler.requestFullSuite({});
    await h.scheduler.idle();
    expect(count()).toBe(2);
    expect(failing(h)).toEqual([]);
    expect(verdictCode(readVerdict(store, h.worktreeId))).toBe(0);
  });

  it("keeps its failure across a daemon restart, and the restarted daemon's run clears it", async () => {
    const { repo, count } = setupRepo();
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(failing(first).map((s) => s.check)).toEqual([SETUP_CHECK]);
    await first.scheduler.close();

    // A daemon that has not run yet reads the failure from the store.
    expect(readVerdict(store, first.worktreeId).failures.setups).toBe(1);
    const second = await openHarness(repo.main, store, repo.commonDir, { policy: RUN_MISSING });
    await second.scheduler.start();
    await second.scheduler.idle();
    expect(count()).toBe(2);
    expect(failing(second)).toEqual([]);
    expect(store.knownStates.get(second.worktreeId, SETUP_CHECK)?.outcome).toBe("pass");
  });
});
