import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedDirectMetaKey, observedMetaKey } from "../../src/core/keys/index.js";
import type { AbsolutePath, PytestProject } from "../../src/core/types/index.js";
import { createPytestAdapter } from "../../src/runners/pytest/adapter.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { findPython, PYTHONS, pythonEnv } from "../helpers/pytest-env.js";
import { pytestRepos } from "../integration/pytest-repo.js";
import { openHarness, openRepoStore } from "./helpers.js";

/*
 * Spec 016 D4 through the real pytest adapter, on the small fixture with
 * three test files of its own. The written-directory bound (the human,
 * 2026-10-25, O1 (b)): a git-ignored module a test imports is kept, one
 * below the directory its `tempfile.mkdtemp` created is dropped. Goal 6:
 * a module the test file reaches through another, which a process it
 * started imports itself, is stored as a direct mark beside no observed path.
 */

const SLOW = { timeout: 300_000 } as const;
const KEPT = "outcomes/test_kept.py";
const SCRATCH = "outcomes/test_scratch.py";
const THROUGH = "outcomes/test_through.py";
const CHILD = "outcomes/through_child.py";
const B = "src/app/through_b.py";
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: [KEPT, SCRATCH, THROUGH],
};

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "dist/\n.tmp/\n",
  "dist/built_x.py": "X = 1\n",
  ".tmp/.keep": "",
  [KEPT]: `"""Imports a module of the git-ignored dist/ by a computed name."""

import importlib
import os
import sys


def test_loads_a_built_module():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.join(root, "dist"))
    try:
        assert importlib.import_module("built_" + "x").X == 1
    finally:
        sys.path.pop(0)
`,
  [SCRATCH]: `"""Imports a module it wrote below its own mkdtemp directory."""

import importlib
import os
import sys
import tempfile


def test_loads_a_module_it_wrote():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scratch = tempfile.mkdtemp(dir=os.path.join(root, ".tmp"))
    with open(os.path.join(scratch, "scratch_m.py"), "w") as out:
        out.write("M = 1\\n")
    sys.path.insert(0, scratch)
    try:
        assert importlib.import_module("scratch_" + "m").M == 1
    finally:
        sys.path.pop(0)
`,
  [THROUGH]: `"""Reaches app.through_b through app.through_a; the child it starts imports app.through_b itself."""

import os
import subprocess
import sys

from app.through_a import VALUE


def test_child_imports_b():
    child = os.path.join(os.path.dirname(__file__), "through_child.py")
    done = subprocess.run([sys.executable, child], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    assert done.stdout == f"{VALUE}\\n"
`,
  "src/app/through_a.py": "from app.through_b import VALUE\n",
  [B]: "VALUE = 1\n",
  [CHILD]: "from app.through_b import VALUE\n\nprint(VALUE)\n",
};

const repos = pytestRepos("pytest-observed");

describe.each(PYTHONS)(
  "scheduler over the real pytest adapter under Python %s (016 D4)",
  (version) => {
    /** The scheduler over the real pytest adapter, with the pytest files it ran. */
    async function open(root: AbsolutePath) {
      const store = openRepoStore(join(root, ".git"));
      const pytest = await createPytestAdapter(PROJECT, {
        root,
        source: pythonEnv(),
        cacheDir: join(root, "..", `pytest-cache-${version}`) as AbsolutePath,
      });
      const runs: string[][] = [];
      const run = pytest.run.bind(pytest);
      pytest.run = (files, options) => {
        runs.push(files.map((f) => f.path));
        return run(files, options);
      };
      const h = await openHarness(root, store, join(root, ".git"), {
        adapters: [pytest],
        policy: RUN_MISSING,
      });
      const meta = (key: string) => JSON.parse(store.meta.get(key) ?? "{}");
      return { h, runs, meta };
    }

    it(
      "keeps an ignored module a test imports, drops one below its mkdtemp directory, and marks a child's import of a closure path",
      SLOW,
      async (ctx) => {
        const found = findPython(version);
        if (!found.ok) {
          if (process.env.CI) throw new Error(`pytest fixture unavailable on CI: ${found.reason}`);
          return ctx.skip(`uv or Python ${version} is absent: ${found.reason}`);
        }
        const root = repos.createRepo(`main-${version}`, FILES) as AbsolutePath;
        execFileSync("uv", ["sync", "--locked", "--python", found.python], {
          cwd: root,
          env: pythonEnv(),
          stdio: "pipe",
        });
        const first = await open(root);
        await first.h.scheduler.start();
        await first.h.scheduler.idle();
        const observed = first.meta(observedMetaKey(PROJECT.name));
        expect(observed[KEPT]).toEqual(["dist/built_x.py"]);
        expect(observed[SCRATCH]).toBeUndefined();
        // B is in the static closure: only the child's script grew the observed set.
        expect(observed[THROUGH]).toEqual([CHILD]);
        const direct = first.meta(observedDirectMetaKey(PROJECT.name));
        expect(Object.keys(direct)).toEqual([THROUGH]);
        expect(direct[THROUGH]).toEqual(expect.arrayContaining([CHILD, B]));
        expect(direct[THROUGH]).not.toContain("src/app/through_a.py");
        expect(first.runs.flat().filter((p) => p === SCRATCH)).toHaveLength(1);
        await first.h.scheduler.close();

        // A restart: the kept path keys the file, which inherits its own pass; nothing grew.
        const again = await open(root);
        await again.h.scheduler.start();
        await again.h.scheduler.idle();
        expect(again.runs).toEqual([]);
        expect(again.meta(observedMetaKey(PROJECT.name))).toEqual(observed);
      },
    );
  },
);
