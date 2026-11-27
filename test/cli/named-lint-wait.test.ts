import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printNamed } from "../../src/cli/named-print.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { refusedCpu } from "../../src/core/lint/pass/cpu-wait.js";
import { lintScope, writeQuiet } from "../../src/core/lint/pass/records.js";
import type { LintStore } from "../../src/core/lint/store/types.js";
import type { EpochMs, RelativePath, RevisionNumber } from "../../src/core/types/common.js";
import type { LintKnownState, LintOutcome } from "../../src/core/types/lint.js";
import { check as lintCheck, open } from "../lint/helpers.js";
import { B, NOW, repoWith } from "./status-wait-fixture.js";

/*
 * Row 017-37 (gh-238, spec 017 D8): `squeal status --wait <ms> <path>...`
 * also waits for the lint of the named paths the pass lints, and gives it
 * apart from the repository's count, in text and JSON. The backlog of a
 * config keying waits under its lease; the named file does not wait for it.
 */

const BACKLOG = ["src/x1.ts", "src/x2.ts"] as RelativePath[];

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = (): DaemonSync => ({ current: synced, stop: () => {} });

const wait = (root: string, paths: readonly string[], timeoutMs: number) =>
  waitForNamed(root as never, paths, {
    timeoutMs,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW as EpochMs,
    sync,
    ask: async () => [],
  });

function stateOf(id: string, path: string, outcome: LintOutcome): LintKnownState {
  return {
    worktreeId: id as never,
    check: lintCheck(path),
    outcome,
    judged: null,
    stale: false,
    reason: null,
    changedAt: 1 as RevisionNumber,
  };
}

/**
 * B's tests current; lint on, B pending as an edited file, two other files
 * pending in a config keying's backlog that the pool refuses for its share.
 */
function lintedRepo(named: LintOutcome = "pending") {
  const { repo } = repoWith([], [B]);
  writeFileSync(join(repo.main, "squeal.config.json"), '{ "lint": { "enabled": true } }\n');
  const lint = open(repo.commonDir);
  const id = repo.mainId;
  lint.states.upsertMany([stateOf(id, B, named), ...BACKLOG.map((p) => stateOf(id, p, "pending"))]);
  const scope = lintScope(id, "eslint");
  writeQuiet(lint.meta, scope, new Set(BACKLOG));
  refusedCpu(lint.meta, scope, { busy: 3, limit: 18, refusal: "share" }, NOW as EpochMs);
  return { repo, lint };
}

const outcomes = (lint: LintStore, id: string) =>
  Object.fromEntries(lint.states.list(id as never).map((s) => [s.check.path, s.outcome]));

describe("a named wait gets the lint of the paths it names (row 017-37)", () => {
  it("returns the named file's lint verdict before the backlog finishes", async () => {
    const { repo, lint } = lintedRepo();
    const linted = setTimeout(() => lint.states.upsertMany([stateOf(repo.mainId, B, "fail")]), 150);
    const got = await wait(repo.main, [B], 10_000);
    clearTimeout(linted);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("settled");
    expect(got.waitedMs).toBeGreaterThanOrEqual(100);
    expect(got.waitedMs).toBeLessThan(5_000);
    expect(got.lint).toEqual({
      done: 1,
      pending: 0,
      failing: 1,
      unknown: 0,
      files: [{ path: B, tool: "eslint", outcome: "fail" }],
    });
    expect(outcomes(lint, repo.mainId)).toMatchObject({
      "src/x1.ts": "pending",
      "src/x2.ts": "pending",
    });
  });

  it("waits to the deadline while the named file lints; the test files still decide", async () => {
    const { repo } = lintedRepo();
    const got = await wait(repo.main, [B], 300);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("settled");
    expect(got.waitedMs).toBeGreaterThanOrEqual(250);
    expect(got.lint?.files).toEqual([
      {
        path: B,
        tool: "eslint",
        outcome: "pending",
        waits: "linting",
        reason: "linting as an edited file",
      },
    ]);
  });

  it("names a backlog file's wait for the pool's share, with no CPU numbers, in text and JSON", async () => {
    const { repo } = lintedRepo("pass");
    const got = await wait(repo.main, [B, "src/x1.ts"], 200);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    const backlog = got.lint?.files.find((f) => f.path === "src/x1.ts");
    expect(backlog).toMatchObject({ outcome: "pending", waits: "backlog" });
    expect(backlog?.reason).toBe(
      "waits in the backlog of a full re-lint, waiting for this worktree's share of the worker pool",
    );
    expect(backlog?.cpuWait?.cause).toBe("share");
    const text = namedText(got, NOW as EpochMs);
    expect(text).toContain("Lint of the named files: 2 checks, 1 linted, 1 pending.");
    expect(text).toContain(
      "  src/x1.ts (eslint): pending: waits in the backlog of a full re-lint, waiting for this worktree's share of the worker pool",
    );
    expect(text).not.toMatch(/busy|limit/);

    const out: string[] = [];
    const io = { cwd: repo.main, env: {}, stdout: (s: string) => out.push(s), stderr: () => {} };
    await printNamed(Promise.resolve(got), { json: true }, io as never, () => NOW as EpochMs);
    const json = JSON.parse(out.join(""));
    expect(json.selection.lint).toEqual(JSON.parse(JSON.stringify(got.lint)));
    expect(json.selection.lint).toMatchObject({ done: 1, pending: 1, failing: 0, unknown: 0 });
  });

  it("gives no lint and does not wait when lint is off", async () => {
    const { repo } = lintedRepo();
    writeFileSync(join(repo.main, "squeal.config.json"), '{ "lint": { "enabled": false } }\n');
    const got = await wait(repo.main, [B], 5_000);
    if (got.outcome === "unavailable") throw new Error("unavailable");
    expect(got.outcome).toBe("settled");
    expect(got.waitedMs).toBeLessThan(2_000);
    expect(got.lint).toBeUndefined();
  });
});
