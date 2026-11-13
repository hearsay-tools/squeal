import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import {
  createHostedPytest,
  type HostedPytestOptions,
  pytestEnvironmentTopic,
} from "../../src/core/runner-host/process-host.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { PytestProject } from "../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../src/core/types/runner.js";
import { createPytestAdapter } from "../../src/runners/pytest/adapter.js";
import { type PytestEnv, requireSynced, type Synced, syncFixture } from "../helpers/pytest-env.js";
import { hostsOf, sourceHost, steady } from "./process-helpers.js";

/*
 * Spec 021 D8 (row 021-12) done-when: the pytest adapter in a runner host,
 * driven through the proxy, gives the same answers, notes and results as
 * the adapter in this process, on two uv-synced copies of the small
 * fixture. Its runs use the `.venv` in the root, which stays where it is
 * (`runner-split.md` Q5, 019-04 Q2). A host killed during a run ends it
 * `crashed`, so its tier is `unknown`, and the next call starts a new host.
 */

const small = resolve(import.meta.dirname, "../fixtures/pytest/small");
const SLOW = { timeout: 180_000 } as const;
const VERSION = "3.13";
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};
const WHERE = "tests/test_where.py";
const HOLD = "tests/test_hold.py";
const ref = (path: string): TestFileRef => ({ project: "small", path });

/** Its run passes only with the `.venv` in the root as the interpreter's prefix. */
const WHERE_TEST = `import pathlib
import sys

def test_runs_in_the_roots_venv():
    root = pathlib.Path(__file__).resolve().parents[1]
    assert pathlib.Path(sys.prefix).resolve() == root / ".venv"
`;

/** While `dir/hold` exists, marks its start in `dir` and waits for `dir/release`, up to a minute. */
const holdTest = (dir: string) => `import os
import time

def test_holds_until_released():
    if not os.path.exists(${JSON.stringify(join(dir, "hold"))}):
        return
    open(${JSON.stringify(join(dir, "started"))}, "w").write(str(os.getpid()))
    for _ in range(600):
        if os.path.exists(${JSON.stringify(join(dir, "release"))}):
            return
        time.sleep(0.1)
`;

interface Copy {
  readonly synced: Synced;
  readonly scratch: string;
}

const copies: Copy[] = [];
beforeAll(() => {
  for (let i = 0; i < 2; i++) {
    const synced = syncFixture(small, VERSION);
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sq-pytest-host-")));
    if (synced.ok) {
      writeFileSync(join(synced.env.root, WHERE), WHERE_TEST);
      writeFileSync(join(synced.env.root, HOLD), holdTest(scratch));
    }
    copies.push({ synced, scratch });
  }
}, 300_000);
afterAll(() => {
  for (const { synced, scratch } of copies) {
    if (synced.ok) synced.env.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  }
});

/** The environment a run inherits: the fixture's, without the bytecode switch the tests drop. */
function sourceOf(fixture: PytestEnv): NodeJS.ProcessEnv {
  const { PYTHONDONTWRITEBYTECODE: _, ...source } = fixture.env;
  return source;
}

interface Opened {
  readonly root: AbsolutePath;
  readonly adapter: RunnerAdapter;
  readonly notes: (readonly [string, string | undefined])[];
  readonly runOptions: () => RunOptions;
}

type Make = (fixture: PytestEnv, options: HostedPytestOptions) => Promise<RunnerAdapter>;
const inProcess: Make = (fixture, options) =>
  createPytestAdapter(PROJECT, { ...options, source: sourceOf(fixture) });
const hosted: Make = (fixture, options) =>
  createHostedPytest(sourceHost(squealVersion(), sourceOf(fixture)), PROJECT, options);

async function open(
  make: Make,
  copy: Copy,
  ctx: Parameters<typeof requireSynced>[0],
  more: Partial<HostedPytestOptions> = {},
): Promise<Opened> {
  const fixture = requireSynced(ctx, copy.synced);
  const root = realpathSync(fixture.root) as AbsolutePath;
  const notes: (readonly [string, string | undefined])[] = [];
  const tempDir = join(copy.scratch, "tmp") as AbsolutePath;
  mkdirSync(tempDir, { recursive: true });
  const adapter = await make(fixture, {
    root,
    note: (text, topic) => notes.push([text, topic]),
    concurrency: () => 2,
    tempDir,
    cacheDir: join(copy.scratch, "cache") as AbsolutePath,
    childEnv: { SQUEAL_DAEMON_CHILD: "mark-021-12" },
    ...more,
  });
  onTestFinished(() => adapter.close());
  return {
    root,
    adapter,
    notes,
    // A directory of its own per run, as the daemon gives: a run reads its events from it.
    runOptions: () => {
      const runId = randomUUID();
      return {
        runId,
        logDir: join(copy.scratch, `logs-${runId}`) as AbsolutePath,
        timeoutMs: 60_000,
      };
    },
  };
}

/** `report` as `steady` gives it, Python's object addresses masked: each process has its own. */
function comparable(report: RunReport): unknown {
  return JSON.parse(JSON.stringify(steady(report)).replace(/0x[0-9a-f]+/g, "0x"));
}

/** `steps` through each adapter, the in-process one on the first copy; both results. */
async function both<T>(
  ctx: Parameters<typeof requireSynced>[0],
  steps: (opened: Opened) => Promise<T>,
  more: Partial<HostedPytestOptions> = {},
): Promise<{ local: T; remote: T }> {
  const [first, second] = copies as [Copy, Copy];
  const local = await steps(await open(inProcess, first, ctx, more));
  const remote = await steps(await open(hosted, second, ctx, more));
  return { local, remote };
}

/** Every `pyvenv.cfg` under `dir`. */
function venvsUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((path) =>
    path.endsWith("pyvenv.cfg"),
  );
}

describe("the pytest adapter through a runner host", () => {
  it("lists, keys, describes and notes the same", SLOW, async (ctx) => {
    const { local, remote } = await both(ctx, async ({ adapter, notes }) => {
      const testFiles = await adapter.testFiles();
      return {
        name: adapter.name,
        adapterVersion: adapter.adapterVersion,
        focuses: adapter.traits.focuses(ref(WHERE)),
        testFiles,
        environment: await adapter.environment(),
        closures: await Promise.all(testFiles.map((f) => adapter.closure(f))),
        checks: await Promise.all(testFiles.map((f) => adapter.enumerate(f))),
        // Its quiet-pass check of the environment (task 007-26), a member the host reports.
        recheck: await adapter.recheck?.(),
        notes: [...notes],
      };
    });
    expect(remote).toEqual(local);
    expect(local.recheck).toEqual({ recreatedProjects: [] });
    expect(local.testFiles).toContainEqual(ref(WHERE));
    // The environment is the root's: its `pyvenv.cfg` is a file the core hashes.
    expect(local.environment[0]?.files).toContain(".venv/pyvenv.cfg");
  });

  it(
    "runs with the same results in the root's .venv, which stays where it is",
    SLOW,
    async (ctx) => {
      const before = copies.map(({ synced }) =>
        synced.ok ? statSync(join(synced.env.root, ".venv/pyvenv.cfg")) : null,
      );
      const { local, remote } = await both(ctx, async (opened) => {
        const files = (await opened.adapter.testFiles()).filter((f) => f.path !== HOLD);
        const report = await opened.adapter.run(files, opened.runOptions());
        return { report: comparable(report), notes: [...opened.notes] };
      });
      expect(remote).toEqual(local);
      const report = remote.report as RunReport;
      expect(report.end).toBe("completed");
      expect(report.results.every((r) => r.outcome === "pass")).toBe(true);
      expect(report.results.map((r) => r.check.fullName)).toContain("test_runs_in_the_roots_venv");
      copies.forEach(({ synced, scratch }, i) => {
        if (!synced.ok) return;
        const after = statSync(join(synced.env.root, ".venv/pyvenv.cfg"));
        expect([after.ino, after.mtimeMs]).toEqual([before[i]?.ino, before[i]?.mtimeMs]);
        // No environment was made or copied outside the root.
        expect(venvsUnder(scratch)).toEqual([]);
      });
    },
  );

  it(
    "finds the same affected files after an edit, and runs a failing edit the same",
    SLOW,
    async (ctx) => {
      const core = "src/app/core.py";
      const originals = copies.map(({ synced }) =>
        synced.ok ? readFileSync(join(synced.env.root, core), "utf8") : "",
      );
      onTestFinished(() =>
        copies.forEach(({ synced }, i) => {
          if (synced.ok) writeFileSync(join(synced.env.root, core), originals[i] ?? "");
        }),
      );
      const { local, remote } = await both(ctx, async ({ adapter, root, runOptions }) => {
        await adapter.testFiles();
        const text = readFileSync(join(root, core), "utf8");
        writeFileSync(
          join(root, core),
          text.replace("lazy.double(sum(xs))", "lazy.double(sum(xs)) + 1"),
        );
        const invalidated = await adapter.invalidate([{ path: core, kind: "change" }]);
        const affected = await adapter.affected([core]);
        const report = await adapter.run(
          [...affected.direct, ...affected.transitive],
          runOptions(),
        );
        return { invalidated, affected, report: comparable(report) };
      });
      expect(remote).toEqual(local);
      expect((local.report as RunReport).results.some((r) => r.outcome === "fail")).toBe(true);
    },
  );

  it("writes an environment note only when it changes the topic's latest", SLOW, async (ctx) => {
    const topic = pytestEnvironmentTopic(PROJECT);
    const ready = `pytest project "small": its Python environment is ready`;
    const seen = async (latest: string) => {
      const { local, remote } = await both(ctx, async ({ notes }) => [...notes], {
        latestNote: (asked) => (asked === topic ? latest : undefined),
      });
      expect(remote).toEqual(local);
      return local.filter(([, on]) => on === topic);
    };
    // A stale latest note is replaced; the same one is not written again.
    expect(await seen("an earlier daemon's note")).toEqual([[ready, topic]]);
    expect(await seen(ready)).toEqual([]);
  });

  it.runIf(process.platform === "linux")(
    "ends a run crashed when its host is killed, and the next call starts a new host",
    SLOW,
    async (ctx) => {
      const copy = copies[1] as Copy;
      const fixture = requireSynced(ctx, copy.synced);
      const root = realpathSync(fixture.root) as AbsolutePath;
      const notes: string[] = [];
      const [runner] = createPytestRunners([PROJECT], {
        root,
        stateDir: join(copy.scratch, "state") as AbsolutePath,
        tempDir: join(copy.scratch, "tmp") as AbsolutePath,
        tierSize: () => 2,
        note: (text) => notes.push(text),
        host: sourceHost(squealVersion(), sourceOf(fixture)),
      });
      if (runner === undefined) throw new Error("no pytest runner");
      onTestFinished(async () => {
        writeFileSync(join(copy.scratch, "release"), "");
        await runner.close();
      });
      await runner.open();
      const [first] = hostsOf("pytest");
      expect(hostsOf("pytest")).toHaveLength(1);
      writeFileSync(join(copy.scratch, "hold"), "");
      const options = {
        runId: "held",
        logDir: join(copy.scratch, "held") as AbsolutePath,
        timeoutMs: 60_000,
      };
      const held = runner.run([ref(HOLD)], options);
      await expect
        .poll(() => existsSync(join(copy.scratch, "started")), { timeout: 60_000 })
        .toBe(true);
      process.kill(first ?? 0, "SIGKILL");
      const report = await held;
      expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
      expect(notes).toContain(
        "the pytest runner host exited (signal SIGKILL); a new one starts at the next call",
      );

      writeFileSync(join(copy.scratch, "release"), "");
      await runner.invalidate([]);
      const again = await runner.run([ref(HOLD)], { ...options, runId: "again" });
      expect(again).toMatchObject({ end: "completed" });
      expect(again.results.map((r) => r.outcome)).toEqual(["pass"]);
      const second = hostsOf("pytest");
      expect(second).toHaveLength(1);
      expect(second[0]).not.toBe(first);
    },
  );
});
