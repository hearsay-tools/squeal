import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WorktreePaths } from "../../../../src/core/fs/worktree-paths.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import type { TestFileRef } from "../../../../src/core/types/keys.js";
import type { PytestProject } from "../../../../src/core/types/policy.js";
import { parsePytestEvents } from "../../../../src/runners/pytest/run/events.js";
import { readBatch } from "../../../../src/runners/pytest/run/report.js";
import { type PytestRunOptions, runPytest } from "../../../../src/runners/pytest/run/run.js";

/*
 * Row 011-232: a cut or the deadline sends SIGTERM to each running batch's
 * process group. Python's own action ends pytest at once, so nothing is
 * written after the signal. A project's own SIGTERM handler can let pytest
 * go on and write the interrupted item's teardown, which completes its
 * file. The fake Python here writes the first file whole and the held
 * file's setup. With `FAKE_HANDLER` it traps SIGTERM and writes the held
 * file's call and teardown, then exits 2 (`exit`) or goes on until the
 * SIGKILL after the grace (`ignore`); without it, SIGTERM ends it. So the
 * order does not depend on the host.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-cut-"))) as AbsolutePath;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const DONE = "tests/test_done.py";
const HELD = "tests/test_held.py";
const line = (event: object) => `${JSON.stringify(event)}\n`;
const phase = (path: string, when: string, outcome: string) =>
  line({
    type: "phase",
    nodeid: `${path}::test_it`,
    when,
    outcome,
    duration: 0.01,
    location: { path, line: 0, domain: "test_it" },
    longrepr: outcome === "failed" ? "E   SystemExit: 1" : null,
    crash: null,
    wasxfail: null,
  });
const item = (path: string) => line({ type: "item", nodeid: `${path}::test_it`, last: true });
/** What pytest writes up to the signal: the first file whole, the held file's setup. */
const BEFORE =
  line({ type: "start", pid: 1, python: "3.12.0", pytest: "8.3.0" }) +
  [DONE, HELD]
    .map((path) =>
      line({
        type: "collect",
        nodeid: path,
        kind: "Module",
        path: join(root, path),
        outcome: "passed",
        longrepr: null,
      }),
    )
    .join("") +
  line({
    type: "collected",
    items: [DONE, HELD].map((path) => ({
      nodeid: `${path}::test_it`,
      name: "test_it",
      path: join(root, path),
    })),
  }) +
  item(DONE) +
  phase(DONE, "setup", "passed") +
  phase(DONE, "call", "passed") +
  phase(DONE, "teardown", "passed") +
  item(HELD) +
  phase(HELD, "setup", "passed");
/** What a handler that raises `SystemExit` lets pytest write after the signal. */
const AFTER =
  phase(HELD, "call", "failed") +
  phase(HELD, "teardown", "passed") +
  line({ type: "session", exitstatus: 2 });

mkdirSync(join(root, "tests"), { recursive: true });
for (const path of [DONE, HELD]) writeFileSync(join(root, path), "");
writeFileSync(join(root, "before.jsonl"), BEFORE);
writeFileSync(join(root, "after.jsonl"), AFTER);
mkdirSync(join(root, "env", "bin"), { recursive: true });
const python = join(root, "env", "bin", "python") as AbsolutePath;
writeFileSync(
  python,
  [
    "#!/bin/sh",
    `cat ${JSON.stringify(join(root, "before.jsonl"))} > "$SQUEAL_PYTEST_EVENTS"`,
    `after='cat ${JSON.stringify(join(root, "after.jsonl"))} >> "$SQUEAL_PYTEST_EVENTS"'`,
    "case $FAKE_HANDLER in",
    `  exit) trap "$after; exit 2" TERM;;`,
    `  ignore) trap "$after" TERM;;`,
    "esac",
    "echo ready",
    "sleep 60 & wait",
    "sleep 60 & wait",
    "",
  ].join("\n"),
);
chmodSync(python, 0o755);

const project: PytestProject = { name: "cut", args: [], env: {}, include: ["tests/test_*.py"] };
const refs: TestFileRef[] = [DONE, HELD].map((path) => ({ project: "cut", path }));
const environment: PytestRunOptions["environment"] = {
  discovery: { kind: "found", source: "venv", env: join(root, "env") as AbsolutePath, python },
  config: null,
  plugins: [],
  runEnv: { PATH: process.env.PATH },
};

async function ready(logDir: string): Promise<void> {
  const stdout = join(logDir, "stdout-0.log");
  for (let waited = 0; !existsSync(stdout) || !readFileSync(stdout, "utf8").includes("ready"); ) {
    if (waited > 20_000) throw new Error("the fake python never started");
    await new Promise((r) => setTimeout(r, 20));
    waited += 20;
  }
}

async function cut(timeoutMs: number | null, stops: boolean, handler?: "exit" | "ignore") {
  const logDir = join(root, "logs", randomUUID()) as AbsolutePath;
  const stop = new AbortController();
  const running = runPytest({
    root,
    project,
    environment,
    files: refs,
    logDir,
    timeoutMs,
    cacheDir: join(root, "cache") as AbsolutePath,
    childEnv: handler === undefined ? {} : { FAKE_HANDLER: handler },
    ...(stops ? { signal: stop.signal } : {}),
  });
  await ready(logDir);
  if (stops) stop.abort();
  const { report } = await running;
  const events = readFileSync(join(logDir, "events-0.jsonl"), "utf8");
  const [batch] = JSON.parse(readFileSync(join(logDir, "run.json"), "utf8")).batches;
  return { report, events, batch };
}

const files = refs.map((testFile) => ({
  testFile,
  real: join(root, testFile.path) as AbsolutePath,
}));
const wholeFiles = (events: string) =>
  readBatch(parsePytestEvents(events), files, root, new WorktreePaths(root))
    .files.filter((f) => f.completed)
    .map((f) => f.testFile.path);

describe("runPytest cut by Squeal's signal (row 011-232)", () => {
  it.each([
    { by: "a stop's signal", timeoutMs: null, stops: true },
    { by: "the deadline", timeoutMs: 2_000, stops: false },
  ])(
    "completes no file of a batch whose handler wrote a teardown after $by and exited",
    async ({ timeoutMs, stops }) => {
      const { report, events, batch } = await cut(timeoutMs, stops, "exit");
      // The precondition: the teardown written after the signal made the held file whole.
      expect(events).toBe(BEFORE + AFTER);
      expect(batch).toMatchObject({ exit: { code: 2, signal: null }, signalled: true });
      expect(wholeFiles(events)).toEqual([DONE, HELD]);
      // Nothing tells which events came before the signal, so the batch's first file goes too.
      expect(report).toMatchObject({ completedFiles: [], results: [], fileErrors: [] });
      expect(report.end).toBe(stops ? "completed" : "timed-out");
    },
  );

  it("completes no file of a batch whose handler outlived the grace and got SIGKILL", async () => {
    const { report, events, batch } = await cut(null, true, "ignore");
    expect(events).toBe(BEFORE + AFTER);
    expect(batch).toMatchObject({ exit: { code: null, signal: "SIGKILL" }, signalled: true });
    expect(report).toMatchObject({ end: "completed", completedFiles: [], results: [] });
  });

  it.each([
    { by: "a stop's signal", timeoutMs: null, stops: true },
    { by: "the deadline", timeoutMs: 2_000, stops: false },
  ])(
    "keeps the files completed before $by when it ended the batch (D6)",
    async ({ timeoutMs, stops }) => {
      const { report, events, batch } = await cut(timeoutMs, stops);
      expect(events).toBe(BEFORE);
      expect(batch).toMatchObject({ exit: { code: null, signal: "SIGTERM" }, signalled: true });
      expect(report.completedFiles).toEqual([refs[0]]);
      expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([[DONE, "pass"]]);
      expect(report.end).toBe(stops ? "completed" : "timed-out");
    },
  );
});

// Row 018-38: a run a runner host starts after its daemon died, the checkout removed since.
describe("runPytest once the checkout holding its store is gone (row 018-38)", () => {
  it.each([
    { stop: "a stop's signal already aborted", signal: AbortSignal.abort() },
    { stop: "no stop", signal: undefined },
  ])("makes and starts nothing, with $stop", async ({ signal }) => {
    const checkout = join(root, "removed", randomUUID());
    const store = join(checkout, ".git", "squeal");
    mkdirSync(store, { recursive: true });
    rmSync(checkout, { recursive: true });
    const logDir = join(store, "runs", randomUUID(), "pytest", "cut") as AbsolutePath;
    const { report } = await runPytest({
      root,
      project,
      environment,
      files: refs,
      logDir,
      timeoutMs: null,
      cacheDir: join(root, "cache") as AbsolutePath,
      ...(signal === undefined ? {} : { signal }),
    });
    expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
    expect(report.failure).toContain(logDir);
    expect(existsSync(checkout)).toBe(false);
  });

  it("reports nothing of a run stopped after the checkout went, and makes nothing", async () => {
    const checkout = join(root, "removed", randomUUID());
    mkdirSync(join(checkout, ".git", "squeal"), { recursive: true });
    const logDir = join(checkout, ".git", "squeal", "runs", randomUUID(), "pytest", "cut");
    const stop = new AbortController();
    const running = runPytest({
      root,
      project,
      environment,
      files: refs,
      logDir: logDir as AbsolutePath,
      timeoutMs: null,
      cacheDir: join(root, "cache") as AbsolutePath,
      signal: stop.signal,
    });
    await ready(logDir);
    rmSync(checkout, { recursive: true });
    stop.abort();
    const { report } = await running;
    expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
    expect(report.failure).toContain(logDir);
    expect(existsSync(checkout)).toBe(false);
  });
});
