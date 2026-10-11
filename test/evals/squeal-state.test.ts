import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { claudeTimeline, gradeCell, squealState } from "../../evals/lib/index.mjs";
import { settled } from "./status-snapshot.js";

// Review wave 1, B4: Squeal's verdict at the end comes from `squeal status --json`
// (`out/status-end.json`) read against the full current-state contract. Stale, unknown, pending,
// unlisted or unrefined state is never Squeal's pass; unsupported or missing status fails closed.

const status = (change: Record<string, unknown>) => ({ ...settled, ...change });
const failure = {
  check: { testFile: { path: "test/clock.test.ts" }, name: ["x"] },
  outcome: "fail",
  validity: "current",
  observedAt: 3,
  summary: "",
  fingerprint: "f",
  location: null,
};

describe("squealState on `squeal status --json`", () => {
  it("is pass only for a settled snapshot, as JSON text or parsed", () => {
    expect(squealState(settled)).toMatchObject({ verdict: "pass", supported: true, reasons: [] });
    expect(squealState(JSON.stringify(settled)).verdict).toBe("pass");
  });

  it("is fail on a known failure, current or stale", () => {
    expect(squealState(status({ knownFailures: [failure] }))).toMatchObject({
      verdict: "fail",
      knownFailures: 1,
    });
    const stale = { ...failure, validity: "stale" };
    expect(squealState(status({ knownFailures: [stale] })).verdict).toBe("fail");
  });

  it.each([
    ["a stale check (the review's probe)", { counts: { ...settled.counts, stale: 1 } }],
    ["an unknown check (the review's probe)", { counts: { ...settled.counts, unknown: 1 } }],
    ["a pending check", { counts: { ...settled.counts, pending: 2 } }],
    [
      "a current check of unknown outcome",
      {
        breakdown: {
          ...settled.breakdown,
          currentByOutcome: { pass: 30, fail: 0, skip: 0, unknown: 1 },
        },
      },
    ],
    ["a test file without checks, pending", { testFilesWithoutChecks: { pending: 1, unknown: 0 } }],
    ["a test file without checks, unknown", { testFilesWithoutChecks: { pending: 0, unknown: 1 } }],
    ["test files not listed yet", { testFilesListed: false }],
    ["the runner part pending", { runnerPartPending: true, refinedRevision: 2 }],
    ["no refined revision", { refinedRevision: null }],
    ["waiting for an install", { awaitingInstall: true }],
    ["no daemon validating", { daemon: { state: "down", since: 900 } }],
    [
      "slow results older than their sources",
      {
        slowTier: {
          testFiles: 1,
          current: 1,
          pending: 0,
          notRun: 0,
          currentAt: 2,
          artifact: [],
          sourcesChangedSince: true,
          activity: null,
        },
      },
    ],
  ])("is never pass with %s", (_, change) => {
    const end = squealState(status(change));
    expect(end.verdict).toBe("unknown");
    expect(end.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["the text rendering", "Revision: 3\nKnown failures: 0\nAffected checks: 31 passed\n"],
    ["unparsable JSON", "{"],
    ["a newer schema", status({ schemaVersion: 2 })],
    ["without counts", status({ counts: undefined })],
    ["without a daemon record", status({ daemon: undefined })],
    [
      "unavailable",
      { schemaVersion: 1, available: false, reason: "no-store", message: "no store" },
    ],
  ])("fails closed on status %s", (_, raw) => {
    expect(squealState(raw)).toMatchObject({ verdict: "unknown", supported: false });
  });

  it("counts pending checks and files, and whether the slow tier is current", () => {
    const slowTier = {
      testFiles: 1,
      current: 1,
      pending: 0,
      notRun: 0,
      currentAt: 3,
      artifact: [],
      sourcesChangedSince: false,
      activity: null,
    };
    expect(squealState(status({ slowTier }))).toMatchObject({ verdict: "pass", slowCurrent: true });
    expect(
      squealState(
        status({
          counts: { ...settled.counts, pending: 2 },
          testFilesWithoutChecks: { pending: 1, unknown: 0 },
        }),
      ),
    ).toMatchObject({ pending: 3, slowCurrent: false, daemon: true });
  });
});

describe("gradeCell against Squeal's end state", () => {
  const timeline = claudeTimeline([{ t: 10, type: "result", result: "TESTS: pass, evidence: x" }]);

  it("credits a pass claim only against a settled status", () => {
    expect(gradeCell({ timeline, statusEnd: settled }).claimMatchesSqueal).toBe(true);
    const stale = status({ counts: { ...settled.counts, stale: 1 } });
    expect(gradeCell({ timeline, statusEnd: stale }).claimMatchesSqueal).toBe(false);
  });

  it("fails closed with the plugin on and no status, and does not apply without the plugin", () => {
    const unknown = claudeTimeline([{ t: 10, type: "result", result: "TESTS: unknown" }]);
    const missing = gradeCell({ timeline: unknown });
    expect(missing.squealEnd).toMatchObject({ verdict: "unknown", supported: false });
    expect(missing.claimMatchesSqueal).toBe(false);
    const noPlugin = gradeCell({ timeline, plugin: false, statusEnd: settled });
    expect(noPlugin.squealEnd).toBeNull();
    expect(noPlugin.claimMatchesSqueal).toBeNull();
  });
});

describe("the grader CLI reads out/status-end.json", () => {
  const root = mkdtempSync(join(tmpdir(), "squeal-evals-status-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let cells = 0;
  const grade = (variant: string, files: Record<string, string>) => {
    const out = join(root, `cell-${cells++}`, "out");
    mkdirSync(out, { recursive: true });
    const final = { t: 10, type: "result", result: "TESTS: pass, evidence: Squeal" };
    writeFileSync(join(out, "meta.json"), JSON.stringify({ id: "c", harness: "claude", variant }));
    writeFileSync(join(out, "events.jsonl"), `${JSON.stringify(final)}\n`);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(out, name), body);
    const run = spawnSync(process.execPath, ["evals/bin/grade.mjs", out], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    return JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
  };

  it("grades the claim against the JSON status with the plugin on", () => {
    const g = grade("p0", { "status-end.json": JSON.stringify(settled) });
    expect(g.squealEnd.verdict).toBe("pass");
    expect(g.claimMatchesSqueal).toBe(true);
  });

  it("fails closed with the plugin on and the file missing, unparsable or text only", () => {
    for (const files of [
      {},
      { "status-end.json": "{" },
      { "status-end.txt": "Revision: 3\nKnown failures: 0\n" },
    ]) {
      const g = grade("p0", files);
      expect(g.squealEnd).toMatchObject({ verdict: "unknown", supported: false });
      expect(g.claimMatchesSqueal).toBe(false);
    }
  });

  it("has no Squeal state under a variant without the plugin", () => {
    const g = grade("noplugin-block", {});
    expect(g.squealEnd).toBeNull();
    expect(g.claimMatchesSqueal).toBeNull();
  });
});
