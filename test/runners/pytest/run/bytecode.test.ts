import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbsolutePath, PytestProject } from "../../../../src/core/types/index.js";
import { readEnvironment } from "../../../../src/runners/pytest/environment/index.js";
import { linkPoints } from "../../../../src/runners/pytest/run/bytecode.js";
import { runPytest } from "../../../../src/runners/pytest/run/run.js";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../../../helpers/pytest-env.js";

/*
 * Task 007-29, live: CPython and pytest's assertion rewriter accept a cached
 * `.pyc` whose source has the same whole-second mtime and size, so an edit
 * that keeps both must still run its own code, for a source module and for a
 * test file alike.
 */

const small = resolve(import.meta.dirname, "../../../fixtures/pytest/small");
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};
const TEST = { project: "small", path: "tests/test_rate.py" };

/** Rewrites `path` to `text`, a change of the same size, back in the second of its old mtime. */
function sameSecond(path: string, text: string): void {
  const before = statSync(path);
  writeFileSync(path, text);
  expect(statSync(path).size).toBe(before.size);
  const second = Math.floor(before.mtimeMs / 1000);
  const mtime = second + (before.mtimeMs / 1000 - second < 0.5 ? 0.75 : 0.25);
  utimesSync(path, before.atime, mtime);
}

describe.each(PYTHONS)("a pytest run under Python %s never executes stale bytecode", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  let scratch = "";
  beforeAll(() => {
    synced = syncFixture(small, version);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-bytecode-")));
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  it("runs a same-size edit made in the same second as the last run's source", async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const { PYTHONDONTWRITEBYTECODE: _, ...source } = fixture.env;
    const environment = await readEnvironment(root, PROJECT, source);
    if (environment.state !== "ready") throw new Error(`environment: ${environment.state}`);
    const cacheDir = join(scratch, "cache") as AbsolutePath;
    // What an earlier version shared: the worktree's own bytecode, removed at the first run.
    const earlier = join(cacheDir, "pycache", root, "src", "app");
    mkdirSync(earlier, { recursive: true });
    writeFileSync(join(earlier, "rate.cpython-313.pyc"), "");
    let runs = 0;
    const outcome = async () => {
      const { report } = await runPytest({
        root,
        project: PROJECT,
        environment,
        files: [TEST],
        logDir: join(scratch, `logs-${runs++}`) as AbsolutePath,
        timeoutMs: 60_000,
        cacheDir,
      });
      expect(report.completedFiles).toEqual([TEST]);
      return report.results.map((r) => r.outcome);
    };
    const rate = join(root, "src/app/rate.py");
    const test = join(root, "tests/test_rate.py");
    writeFileSync(rate, "RATE_PERCENT = 25\n");
    writeFileSync(
      test,
      "from app.rate import RATE_PERCENT\n\nLIMIT = 25\n\n\ndef test_rate():\n    assert RATE_PERCENT == LIMIT\n",
    );

    expect(await outcome()).toEqual(["pass"]);
    sameSecond(rate, "RATE_PERCENT = 20\n");
    expect(await outcome()).toEqual(["fail"]);
    sameSecond(
      test,
      "from app.rate import RATE_PERCENT\n\nLIMIT = 20\n\n\ndef test_rate():\n    assert RATE_PERCENT == LIMIT\n",
    );
    expect(await outcome()).toEqual(["pass"]);

    // The environment's bytecode stays warm across runs; no run's own prefix outlives it.
    const shared = join(cacheDir, "pycache");
    expect(existsSync(join(shared, root, ".venv"))).toBe(true);
    expect(existsSync(join(shared, root, "src"))).toBe(false);
    expect(readdirSync(join(cacheDir, "pycache-runs"))).toEqual([]);
  }, 120_000);
});

describe("linkPoints (task 007-29)", () => {
  const root = "/home/u/work/repo" as AbsolutePath;
  const at = (...kept: string[]) => linkPoints(root, kept as AbsolutePath[]);

  it("links a directory inside the root itself", () => {
    expect(at("/home/u/work/repo/.venv")).toEqual(["/home/u/work/repo/.venv"]);
  });

  it("links one outside the root at its first component off the root's path", () => {
    expect(at("/home/u/.local/share/uv/python/cpython-3.13")).toEqual(["/home/u/.local"]);
    expect(at("/usr")).toEqual(["/usr"]);
  });

  it("keeps nothing that holds the root, the root included", () => {
    expect(at("/home/u", "/home/u/work/repo")).toEqual([]);
  });

  it("drops a link inside another, and a repeated one", () => {
    expect(at("/opt/py/3.13", "/opt/venvs/repo", "/opt/py/3.10")).toEqual(["/opt"]);
  });
});
