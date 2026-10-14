import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import type { AbsolutePath, PytestProject, TestFileRef } from "../../../../src/core/types/index.js";
import { readEnvironment } from "../../../../src/runners/pytest/environment/index.js";
import { scrubBasetemp } from "../../../../src/runners/pytest/run/basetemp.js";
import { runPytest } from "../../../../src/runners/pytest/run/run.js";
import {
  PYTHONS,
  type PytestEnv,
  requireSynced,
  type Synced,
  syncFixture,
} from "../../../helpers/pytest-env.js";

/*
 * Task 007-37, live (lessons.md defect 7): pytest's own basetemp is
 * `<tmp>/pytest-of-<user>/pytest-<n>`, one `<n>` higher every run, so a
 * failure naming its `tmp_path` was delivered as failing differently. Each
 * batch gets a basetemp under the run's scratch directory, written as
 * `<basetemp>` in failure text with pytest's counter as `<n>`, and removed
 * with the run. Task 007-41: only those two are scrubbed, so a failure naming
 * another file below the basetemp keeps its own fingerprint.
 */

const small = resolve(import.meta.dirname, "../../../fixtures/pytest/small");
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};
const TEST = { project: "small", path: "tests/test_tmp.py" };
/** A second file with a test of the same name, so pytest numbers its `tmp_path` `…1`. */
const TWIN = { project: "small", path: "tests/test_tmp_twin.py" };
const READS =
  'def test_reads(tmp_path):\n    with open(tmp_path / "missing.txt") as f:\n        f.read()\n';
/** Opens the file `which.txt` names, so two runs fail on one line with different paths. */
const WHICH =
  "import pathlib\n\n" +
  "WHICH = (pathlib.Path(__file__).parent / 'which.txt').read_text().strip()\n\n" +
  "def test_reads(tmp_path_factory):\n" +
  "    with open(tmp_path_factory.getbasetemp() / WHICH) as f:\n" +
  "        f.read()\n";

describe.each(PYTHONS)("a pytest failure naming tmp_path under Python %s", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  let scratch = "";
  beforeAll(() => {
    synced = syncFixture(small, version);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-basetemp-")));
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  let runs = 0;
  /** Runs `files` and returns `TEST`'s failure message and fingerprint. */
  const failing = async (
    fixture: PytestEnv,
    files: readonly TestFileRef[],
    cacheDir: AbsolutePath,
  ) => {
    const root = realpathSync(fixture.root) as AbsolutePath;
    const environment = await readEnvironment(root, PROJECT, fixture.env);
    if (environment.state !== "ready") throw new Error(`environment: ${environment.state}`);
    const { report } = await runPytest({
      root,
      project: PROJECT,
      environment,
      files,
      logDir: join(scratch, `logs-${runs++}`) as AbsolutePath,
      timeoutMs: 60_000,
      cacheDir,
    });
    const result = report.results.find((r) => r.check.testPath === TEST.path);
    expect(result?.outcome).toBe("fail");
    const message = result?.errors[0]?.message ?? "";
    expect(message).not.toContain(cacheDir);
    return {
      message,
      fingerprint: describeFailure(result?.errors ?? [], result?.location ?? null).fingerprint,
    };
  };

  it("keeps one fingerprint across runs, and its basetemp leaves nothing behind", async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    writeFileSync(join(root, TEST.path), READS);
    writeFileSync(join(root, TWIN.path), READS);
    const cacheDir = join(scratch, "cache") as AbsolutePath;
    const fingerprint = async (files: readonly TestFileRef[]) => {
      const { message, fingerprint } = await failing(fixture, files, cacheDir);
      expect(message).toContain("<basetemp>/test_reads<n>/missing.txt");
      return fingerprint;
    };

    const first = await fingerprint([TEST]);
    expect(await fingerprint([TEST])).toBe(first);
    expect(await fingerprint([TWIN, TEST])).toBe(first);
    expect(readdirSync(join(cacheDir, "basetemp-runs"))).toEqual([]);
    expect(existsSync(join(root, "missing.txt"))).toBe(false);
  }, 120_000);

  it("gives two fingerprints to failures naming two files below the basetemp", async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root);
    writeFileSync(join(root, TEST.path), WHICH);
    const cacheDir = join(scratch, "cache-which") as AbsolutePath;
    const which = join(root, "tests/which.txt");
    try {
      writeFileSync(which, "left.json\n");
      const left = await failing(fixture, [TEST], cacheDir);
      writeFileSync(which, "right.json\n");
      const right = await failing(fixture, [TEST], cacheDir);
      expect(right.fingerprint).not.toBe(left.fingerprint);
      expect(left.message).toContain("<basetemp>/left.json");
      expect(right.message).toContain("<basetemp>/right.json");
    } finally {
      rmSync(which, { force: true });
    }
  }, 120_000);
});

describe("scrubBasetemp (tasks 007-37, 007-41)", () => {
  const base = "/s/basetemp-runs/run-Ab12/3" as AbsolutePath;

  it("writes the counter pytest appends to a numbered directory as <n>", () => {
    expect(scrubBasetemp(`No such file: '${base}/test_reads1/missing.txt'`, base)).toBe(
      "No such file: '<basetemp>/test_reads<n>/missing.txt'",
    );
    expect(scrubBasetemp(`in ${base}/test_reads0`, base)).toBe("in <basetemp>/test_reads<n>");
    expect(scrubBasetemp(`made ${base}/data12/x.csv`, base)).toBe("made <basetemp>/data<n>/x.csv");
  });

  it("keeps every other path component below the basetemp", () => {
    expect(scrubBasetemp(`No such file: '${base}/left.json'`, base)).toBe(
      "No such file: '<basetemp>/left.json'",
    );
    expect(scrubBasetemp(`'${base}/data/x0.csv'`, base)).toBe("'<basetemp>/data/x0.csv'");
    expect(scrubBasetemp(`'${base}/test_reads0/sub1/f'`, base)).toBe(
      "'<basetemp>/test_reads<n>/sub1/f'",
    );
  });

  it("writes the basetemp itself as <basetemp>, and leaves a longer name alone", () => {
    expect(scrubBasetemp(`made ${base}, not ${base}0/x`, base)).toBe(
      `made <basetemp>, not ${base}0/x`,
    );
  });
});
