import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { PytestProject } from "../../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../../src/core/types/runner.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import type { Clock } from "../../../src/runners/pytest/adapter-environment.js";
import { editable, SITE, tempDir, venv, write } from "./environment/tree.js";

/*
 * Review 0.1.642, B1 (spec 027 D3): an admitted empty outside editable is
 * read again wherever a ready environment's stability is checked. Its
 * directory and finder are not among the fingerprint's files, so code that
 * appears there after admission, or during a run, must refuse the
 * environment, recreate the project and withhold the run's results.
 * Synthetic environments: an interpreter stub, no real pytest.
 */

const PROJECT: PytestProject = { name: "app", args: [], env: {}, include: ["tests/test_*.py"] };
const FINDER = "__editable___sb_0_1_0_finder";
const EMPTY_FINDER = "MAPPING: dict[str, str] = {}\nNAMESPACES: dict[str, list[str]] = {}\n";

/** A clock whose sleeps only advance time, so admission settles at once. */
function instant(): Clock {
  let now = 0;
  return {
    now: () => now,
    async sleep(ms) {
      now += ms;
    },
  };
}

/**
 * An interpreter stub: D2's query (`-I -S -c`) answers as CPython 3.13; any
 * other call, a pytest batch, first runs `onRun` (shell) and exits.
 */
function stub(dir: string, onRun: string): string {
  const path = join(dir, "python3.13");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'if [ "$1" = "-I" ]; then',
      `  echo '["3.13.0 (main)", "cpython", "cpython-313"]'`,
      "  exit 0",
      "fi",
      onRun,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

const adapters: RunnerAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map((a) => a.close()));
});

/**
 * A worktree and a sibling build stage outside any checkout. The worktree's
 * `.venv` installs `sb` editable from the stage, its `.pth` adding the
 * stage or installing an empty setuptools finder.
 */
async function open(pth: "directory" | "finder", onRun = (_stage: string) => ":") {
  const base = tempDir();
  const root = join(base, "worktree");
  const stage = join(base, "stage");
  write(stage, { "pyproject.toml": '[project]\nname = "sb"\n' });
  write(root, { "tests/test_app.py": "def test_pass():\n    assert True\n" });
  const line = pth === "directory" ? stage : `import ${FINDER}; ${FINDER}.install()`;
  const site = join(
    venv(
      root,
      ".venv",
      {
        "pytest/__init__.py": "",
        "sb-0.1.0.dist-info/direct_url.json": editable(stage),
        "sb-0.1.0.dist-info/RECORD": `_sb.pth,,\n${FINDER}.py,,\nsb-0.1.0.dist-info/RECORD,,\n`,
        "_sb.pth": `${line}\n`,
        [`${FINDER}.py`]: EMPTY_FINDER,
      },
      stub(base, onRun(stage)),
    ),
    SITE,
  );
  const adapter = await createPytestAdapter(PROJECT, {
    root: root as AbsolutePath,
    source: {},
    cacheDir: join(base, "cache") as AbsolutePath,
    clock: instant(),
  });
  adapters.push(adapter);
  return { adapter, root, stage, site };
}

const state = async (adapter: RunnerAdapter) => {
  const [environment] = await adapter.environment();
  return {
    state: JSON.parse(environment?.resolvedConfig ?? "{}").state,
    runnerVersion: environment?.runnerVersion,
  };
};

const refused = { state: "editable-outside", runnerVersion: "unavailable" };

describe("pytest adapter: an admitted empty outside editable is revalidated (review 0.1.642 B1)", () => {
  it("source appearing in the build stage after admission: recheck recreates and refuses", async () => {
    const { adapter, stage } = await open("directory");
    expect((await state(adapter)).state).toBe("ready");
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });

    writeFileSync(join(stage, "external.py"), "VALUE = 1\n");
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["app"] });
    expect(await state(adapter)).toEqual(refused);
  });

  it("source appearing in a directory the .pth adds: recheck recreates and refuses", async () => {
    const { adapter, stage } = await open("directory");
    mkdirSync(join(stage, "sb"));
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });
    writeFileSync(join(stage, "sb", "__init__.py"), "");
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["app"] });
    expect(await state(adapter)).toEqual(refused);
  });

  it("an empty setuptools finder that starts mapping a module: recheck recreates and refuses", async () => {
    const { adapter, site } = await open("finder");
    expect((await state(adapter)).state).toBe("ready");

    writeFileSync(
      join(site, `${FINDER}.py`),
      "MAPPING = {'sb': '/elsewhere/sb'}\nNAMESPACES = {}\n",
    );
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: ["app"] });
    expect(await state(adapter)).toEqual(refused);
  });

  it("source appearing before a run: the run withholds its results", async () => {
    const { adapter, root, stage } = await open("directory");
    writeFileSync(join(stage, "external.py"), "VALUE = 1\n");
    const report = await adapter.run([{ project: "app", path: "tests/test_app.py" }], {
      runId: "r0",
      logDir: join(root, "..", "logs"),
      timeoutMs: 30_000,
    });
    expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
    expect(await state(adapter)).toEqual(refused);
  });

  it("source appearing during a run: the run withholds its results, then refuses", async () => {
    // The stub writes the module into the stage when pytest would run (a builtin: no PATH).
    const { adapter, root } = await open("directory", (stage) => `: > '${stage}/external.py'`);
    const report = await adapter.run([{ project: "app", path: "tests/test_app.py" }], {
      runId: "r1",
      logDir: join(root, "..", "logs"),
      timeoutMs: 30_000,
    });
    expect(report).toMatchObject({ end: "crashed", completedFiles: [], results: [] });
    expect(report.failure).toMatch(/changed during the run/);
    expect(await state(adapter)).toEqual(refused);
    expect(await adapter.recheck?.()).toEqual({ recreatedProjects: [] });
    expect(await state(adapter)).toEqual(refused);
  });
});
