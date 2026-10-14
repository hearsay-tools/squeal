import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeFailure } from "../../../../src/core/state/fingerprint.js";
import type { AbsolutePath, PytestProject, TestFileRef } from "../../../../src/core/types/index.js";
import { readEnvironment } from "../../../../src/runners/pytest/environment/index.js";
import { scrubBasetemp } from "../../../../src/runners/pytest/run/basetemp.js";
import { runPytest } from "../../../../src/runners/pytest/run/run.js";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../../../helpers/pytest-env.js";

/*
 * Task 007-37, live (lessons.md defect 7): pytest's own basetemp is
 * `<tmp>/pytest-of-<user>/pytest-<n>`, one `<n>` higher every run, so a
 * failure naming its `tmp_path` was delivered as failing differently. Each
 * batch gets a basetemp under the run's scratch directory, written as
 * `<tmp_path>` in failure text and removed with the run.
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

  it("keeps one fingerprint across runs, and its basetemp leaves nothing behind", async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    writeFileSync(join(root, TEST.path), READS);
    writeFileSync(join(root, TWIN.path), READS);
    const environment = await readEnvironment(root, PROJECT, fixture.env);
    if (environment.state !== "ready") throw new Error(`environment: ${environment.state}`);
    const cacheDir = join(scratch, "cache") as AbsolutePath;
    let runs = 0;
    const fingerprint = async (files: readonly TestFileRef[]) => {
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
      expect(message).toContain("<tmp_path>/missing.txt");
      expect(message).not.toContain(cacheDir);
      return describeFailure(result?.errors ?? [], result?.location ?? null).fingerprint;
    };

    const first = await fingerprint([TEST]);
    expect(await fingerprint([TEST])).toBe(first);
    expect(await fingerprint([TWIN, TEST])).toBe(first);
    expect(readdirSync(join(cacheDir, "basetemp-runs"))).toEqual([]);
    expect(existsSync(join(root, "missing.txt"))).toBe(false);
  }, 120_000);
});

describe("scrubBasetemp (task 007-37)", () => {
  const base = "/s/basetemp-runs/run-Ab12/3" as AbsolutePath;

  it("writes a test's tmp_path, numbered by pytest, as <tmp_path>", () => {
    expect(scrubBasetemp(`No such file: '${base}/test_reads1/missing.txt'`, base)).toBe(
      "No such file: '<tmp_path>/missing.txt'",
    );
    expect(scrubBasetemp(`in ${base}/test_reads0`, base)).toBe("in <tmp_path>");
  });

  it("writes the basetemp itself as <basetemp>, and leaves a longer name alone", () => {
    expect(scrubBasetemp(`made ${base}, not ${base}0/x`, base)).toBe(
      `made <basetemp>, not ${base}0/x`,
    );
  });
});
