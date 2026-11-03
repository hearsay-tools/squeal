import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCommitReports } from "../../src/core/commit/store.js";
import { headerLines } from "../../src/core/delivery/index.js";
import { publishGroupActivity } from "../../src/core/slow/state.js";
import { isFastPending, readHeader } from "../../src/core/state/index.js";
import type { StatusHeader } from "../../src/core/types/index.js";
import { inTurn, keys, NOW, type Seeded, seed, states, status } from "./slow-tier-seed.js";

/*
 * Row 019-16 (spec 019 D6, Testing "Texts"): with a `checks` key, a line per
 * configured test group that is not all current, by its name, worded by its
 * moment; the default `slow` group keeps its `Slow tier:` line for the slow
 * files no group owns; and the newest commit report's line (D5 step 3).
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-group-lines-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

const GROUPS_POLICY = {
  slow: { include: ["test/slow/**/*.test.ts", "test/e2e/**/*.test.ts"] },
  checks: [
    { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop", after: ["unit"] },
    { name: "unit", runner: "vitest", tests: ["src/**"], at: "edit" },
    { name: "api", runner: "vitest", tests: ["test/api/**"], at: "pause" },
    { name: "tree", runner: "vitest", tests: ["test/tree/**"], at: "commit" },
  ],
};

// The seed lists `test/e2e/a.test.ts` and `test/e2e/b.test.ts` as well.
const E2E = "test/e2e/a.test.ts";
const E2E_B = "test/e2e/b.test.ts";
const UNIT = "src/a.test.ts";
const API = "test/api/a.test.ts";
const TREE = "test/tree/a.test.ts";
const SLOW = "test/slow/a.test.ts";

/** Every group's file listed, none pending, none run; the given phases set. */
function grouped(pending: Record<string, "queued" | "running" | null> = {}): Seeded {
  const s = seed(GROUPS_POLICY, { revisions: 3 });
  const all = { [E2E]: null, [UNIT]: null, [API]: null, [TREE]: null, [SLOW]: null };
  keys(s.store, s.repo, { ...all, ...pending });
  return s;
}

function lineOf(text: string, name: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith(`${name}:`));
}

describe("a status line per group not all current (019 D6)", () => {
  it("words each moment: edit, pause, Stop and commit", () => {
    const s = grouped({ [UNIT]: "running", [API]: "queued", [TREE]: "queued" });
    inTurn(s);
    publishGroupActivity(s.store, s.repo.mainId, "api", { kind: "waiting", for: "idle" });
    const text = status(s);
    expect(lineOf(text, "unit")).toBe(
      "unit: 1 test file; 1 pending. Squeal runs them after each edit; `squeal run unit --wait 60000` waits for its result.",
    );
    expect(lineOf(text, "api")).toBe(
      "api: 1 test file; 1 pending, waiting for the agent to pause. Squeal runs them when the agent pauses; `squeal run api --wait 60000` runs it now and waits for its result.",
    );
    expect(lineOf(text, "e2e")).toBe(
      "e2e: 2 test files; 2 not run at revision 3. Squeal has not queued them, and Stop waits up to 2 min for them; `squeal run e2e --wait 60000` runs them now and waits for their results.",
    );
    expect(lineOf(text, "tree")).toBe(
      "tree: 1 test file; 1 pending, waiting for a commit. Squeal runs them at each commit; `squeal run tree --wait 60000` runs it now and waits for its result.",
    );
  });

  it("names the group a lane waits for (019-10 decision 10)", () => {
    const s = grouped({ [E2E]: "queued", [E2E_B]: "queued", [UNIT]: "running" });
    inTurn(s);
    publishGroupActivity(s.store, s.repo.mainId, "e2e", { kind: "waiting", for: "fast" });
    expect(lineOf(status(s), "e2e")).toBe(
      "e2e: 2 test files; 2 pending, waiting for the unit group's files. Squeal runs them when the agent pauses and after the unit group's files, and Stop waits up to 2 min for them; `squeal run e2e --wait 60000` runs them now and waits for their results.",
    );
  });

  it("prints no line for a group whose files are all current", () => {
    const s = grouped();
    states(s.store, s.repo, [{ observedAt: 3 }], [API]);
    const text = status(s);
    expect(lineOf(text, "api")).toBeUndefined();
    expect(lineOf(text, "e2e")).toBeDefined();
  });

  it("keeps the `Slow tier:` line for the slow files no group owns", () => {
    const s = grouped();
    const header = readHeader(s.store, s.repo.mainId);
    // `test/e2e/**` is marked slow, but the e2e group owns it: the slow tier counts the rest.
    expect(header.slowTier?.testFiles).toBe(1);
    expect(header.groupTiers?.map((g) => [g.name, g.testFiles])).toEqual([
      ["e2e", 2],
      ["unit", 1],
      ["api", 1],
      ["tree", 1],
    ]);
    s.store.close();
  });

  it("sets aside every group lane's files from the fast work Stop and a wait read", () => {
    const s = grouped({ [E2E]: "queued", [TREE]: "queued" });
    const header = readHeader(s.store, s.repo.mainId);
    expect(header.lanePending?.testFiles).toBe(2);
    expect(header.slowPending?.testFiles).toBe(0);
    expect(isFastPending(header)).toBe(false);
    s.store.close();
  });

  it("carries the group lines in the full header form and in news only when told", () => {
    const s = grouped({ [TREE]: "queued" });
    const header: StatusHeader = readHeader(s.store, s.repo.mainId);
    s.store.close();
    const names = (lines: string[]) => lines.slice(1).map((l) => l.split(":")[0]);
    expect(names(headerLines(header, "squeal"))).toEqual([
      "Slow tier",
      "e2e",
      "unit",
      "api",
      "tree",
    ]);
    expect(names(headerLines(header, "squeal", "news"))).toEqual([]);
    expect(names(headerLines(header, "squeal", "news", { groupTiersChanged: true }))).toEqual([
      "e2e",
      "unit",
      "api",
      "tree",
    ]);
  });
});

describe("the commit line (019 D5 step 3)", () => {
  const REPORT = {
    commit: "abc1234def5678",
    revision: 3,
    at: NOW,
    tests: { files: 5, failures: 0, notDetermined: 1, running: 2, unknown: 0 },
  };

  it("is in status with a `checks` key", () => {
    const s = grouped();
    writeCommitReports(s.store.meta, s.repo.mainId, REPORT.commit, REPORT);
    expect(status(s).split("\n")).toContain(
      "Commit abc1234: 0 known failures; 1 test file not determined (unstaged changes); 2 test files still running",
    );
  });

  it("is not in status without one (the coordinator, 2026-11-03)", () => {
    const s = seed(undefined, { revisions: 3 });
    writeCommitReports(s.store.meta, s.repo.mainId, REPORT.commit, REPORT);
    expect(status(s)).not.toContain("Commit abc1234");
  });
});
