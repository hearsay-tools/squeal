import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedStartupMetaKey } from "../../src/core/keys/index.js";
import type { AbsolutePath, StatusSnapshot } from "../../src/core/types/index.js";
import { sitePackagesDir } from "../../src/runners/pytest/environment/site.js";
import { runMissingConfig } from "../helpers/baseline.js";
import {
  ENTRY_TEST,
  git,
  metaValue,
  pytestRepos,
  ranSince,
  runs,
  settle,
  status,
} from "./pytest-repo.js";

/*
 * 007 review wave 2, B1 and B5, through one daemon per worktree run from the
 * sources. B1: an installed upgrade and a `.pth` change in the ignored
 * `.venv`, with no worktree source, config, `pyvenv.cfg` or pytest marker
 * edit, re-key the project at the next reconciliation pass (`squeal sync`
 * asks one), so the stale passes fail. B5: a `pytest11` plugin that imports
 * a module by a computed name has that module stored in the core's shared
 * start-up set (spec 016 D4) and keyed in the environment: its edit re-runs the plugin's test, and
 * a second synced worktree whose copy differs does not inherit the pass.
 */

const SLOW = { timeout: 600_000 } as const;
const PROJECT = { name: "small", include: ["tests/**/test_*.py"] };
const INSTALLED_TEST = "tests/test_installed.py";
const PLUGIN = "packages/other/src/other/plugin.py";
const HIDDEN = "packages/other/src/other/hidden.py";

const { createRepo, addWorktree, uvSync, startDaemon, sync } = pytestRepos("pytest-env");

const failing = (s: StatusSnapshot) =>
  s.knownFailures
    .map((f) => (f.check.kind === "test" ? f.check.fullName : f.check.testPath))
    .sort();
const site = (root: string) => sitePackagesDir(join(root, ".venv") as AbsolutePath) as string;

/** `reviewdep` at `version` in `root`'s site-packages, as an install leaves it. */
function install(root: string, version: string, value: number): void {
  const dir = site(root);
  for (const v of ["1.0", "2.0"])
    rmSync(join(dir, `reviewdep-${v}.dist-info`), { recursive: true, force: true });
  mkdirSync(join(dir, `reviewdep-${version}.dist-info`), { recursive: true });
  writeFileSync(
    join(dir, `reviewdep-${version}.dist-info`, "METADATA"),
    `Metadata-Version: 2.1\nName: reviewdep\nVersion: ${version}\n`,
  );
  mkdirSync(join(dir, "reviewdep"), { recursive: true });
  writeFileSync(join(dir, "reviewdep", "__init__.py"), `VALUE = ${value}\n`);
}

describe("installed-set changes and start-up plugins reach the daemon (007 B1, B5)", () => {
  it(
    "an installed upgrade and a .pth change with no source edit fail their stale passes",
    SLOW,
    async (ctx) => {
      const main = createRepo("installed", {
        ".gitignore": "node_modules/\n.venv/\n",
        "squeal.config.json": runMissingConfig(JSON.stringify({ pytest: [PROJECT] })),
        [INSTALLED_TEST]: [
          "import pthmod",
          "import reviewdep",
          "",
          "def test_installed_dependency():",
          "    assert reviewdep.VALUE == 1",
          "",
          "def test_pth_path():",
          "    assert pthmod.X == 1",
          "",
        ].join("\n"),
      });
      uvSync(ctx, main);
      install(main, "1.0", 1);
      // Two directories outside site-packages, so only the `.pth` names which one Python sees.
      for (const [dir, x] of [
        ["extra1", 1],
        ["extra2", 2],
      ] as const) {
        mkdirSync(join(main, ".venv", dir), { recursive: true });
        writeFileSync(join(main, ".venv", dir, "pthmod.py"), `X = ${x}\n`);
      }
      const pth = join(site(main), "reviewdep.pth");
      writeFileSync(pth, `${join(main, ".venv", "extra1")}\n`);
      await startDaemon(main);
      const baseline = await settle(main, "the baseline", (s) => s.counts.current > 0);
      expect(failing(baseline)).toEqual([]);
      const at = baseline.revision;

      install(main, "2.0", 2);
      await sync(main);
      const upgraded = await settle(main, "the upgrade", (s) => failing(s).length === 1);
      expect(failing(upgraded)).toEqual(["test_installed_dependency"]);
      // No revision: nothing in the worktree changed.
      expect(upgraded.revision).toBe(at);

      writeFileSync(pth, `${join(main, ".venv", "extra2")}\n`);
      await sync(main);
      const moved = await settle(main, "the .pth change", (s) => failing(s).length === 2);
      expect(failing(moved)).toEqual(["test_installed_dependency", "test_pth_path"]);
      expect(status(main).revision).toBe(at);
    },
  );

  it(
    "a pytest11 plugin's computed import is keyed: its edit re-runs, a differing worktree does not inherit",
    SLOW,
    async (ctx) => {
      const main = createRepo("plugin", {
        ".gitignore": "node_modules/\n.venv/\n",
        "squeal.config.json": runMissingConfig(JSON.stringify({ pytest: [PROJECT] })),
        [PLUGIN]: [
          "import importlib",
          "import pytest",
          'name = "other." + "hidden"',
          "hidden = importlib.import_module(name)",
          "",
          "@pytest.fixture",
          "def other_fixture():",
          "    return hidden.VALUE",
          "",
        ].join("\n"),
        [HIDDEN]: "VALUE = 2\n",
      });
      uvSync(ctx, main);
      await startDaemon(main);
      const baseline = await settle(main, "the baseline", (s) => s.counts.current > 0);
      expect(failing(baseline)).toEqual([]);
      expect(metaValue(main, observedStartupMetaKey("small"))).toContain(HIDDEN);

      // The edit of the hidden module re-runs the plugin's test, which fails.
      const from = runs(main, main).length;
      writeFileSync(join(main, HIDDEN), "VALUE = 3\n");
      const edited = await settle(
        main,
        "the edit of hidden.py",
        (s) => failing(s).length === 1,
        baseline.revision,
      );
      expect(failing(edited)).toEqual(["test_entry_plugin"]);
      expect(ranSince(main, main, from)).toContain(ENTRY_TEST);
      git(main, ["checkout", "--", HIDDEN]);
      await settle(main, "the revert", (s) => failing(s).length === 0);

      // A second synced worktree whose hidden module differs keys it before any run.
      const wt2 = addWorktree(main, "wt2");
      writeFileSync(join(wt2, HIDDEN), "VALUE = 5\n");
      uvSync(ctx, wt2);
      await startDaemon(wt2);
      const second = await settle(wt2, "the second worktree", (s) => s.counts.current > 0);
      expect(failing(second)).toEqual(["test_entry_plugin"]);
      expect(ranSince(main, wt2, 0)).toContain(ENTRY_TEST);
    },
  );
});
