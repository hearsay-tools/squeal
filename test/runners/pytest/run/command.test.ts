import { describe, expect, it } from "vitest";
import type { AbsolutePath, PytestProject } from "../../../../src/core/types/index.js";
import type { PytestPlugin } from "../../../../src/runners/pytest/environment/index.js";
import {
  type InheritedArgs,
  pytestArgs,
  refusalNote,
  refusedFlags,
} from "../../../../src/runners/pytest/run/command.js";

/* Spec 007 D6: the command line, its overrides and the flags Squeal refuses. */

const project: PytestProject = { name: "app", args: [], env: {}, include: ["tests/**/*.py"] };
const none: InheritedArgs = { addopts: [], envAddopts: [] };
const XDIST: PytestPlugin = { distribution: "pytest_xdist", name: "xdist", module: "xdist.plugin" };
const COV: PytestPlugin = {
  distribution: "pytest_cov",
  name: "pytest_cov",
  module: "pytest_cov.plugin",
};
const CWD = "/w" as AbsolutePath;

function args(
  plugins: readonly PytestPlugin[],
  inherited: InheritedArgs = none,
  env: NodeJS.ProcessEnv = {},
  own: PytestProject = project,
) {
  return pytestArgs(
    {
      project: own,
      config: { path: "/w/pyproject.toml" as AbsolutePath, rootdir: CWD, holds: "pytest" },
      plugins,
      env,
      inherited,
      cacheDir: "/tmp/c" as AbsolutePath,
      emptyConfig: "/tmp/c/no-config/pytest.ini" as AbsolutePath,
    },
    CWD,
  );
}

describe("pytestArgs (spec 007 D6)", () => {
  it("passes the config, the plugin and the overrides after the project's args", () => {
    expect(args([], none, {}, { ...project, args: ["--ds=settings", "-x"] })).toEqual([
      "-m",
      "pytest",
      "-c",
      "/w/pyproject.toml",
      "-p",
      "squeal_pytest",
      "--continue-on-collection-errors",
      "--ds=settings",
      "-x",
      "--maxfail=0",
      "-o",
      "cache_dir=/tmp/c",
    ]);
  });

  it("overrides xdist and pytest-cov only when they load", () => {
    expect(args([XDIST, COV])).toEqual(expect.arrayContaining(["-n", "0", "--no-cov"]));
    expect(args([])).not.toContain("-n");
    expect(args([XDIST], { addopts: ["-p", "no:xdist"], envAddopts: [] })).not.toContain("-n");
    const off = { PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1" };
    expect(args([XDIST], none, off)).not.toContain("-n");
    expect(args([XDIST], { addopts: ["-pxdist"], envAddopts: [] }, off)).toContain("-n");
    expect(args([XDIST], none, { ...off, PYTEST_PLUGINS: "xdist.plugin" })).toContain("-n");
  });

  it("passes Squeal's empty config, the cwd as rootdir and conftest cut, without a config file", () => {
    const own = pytestArgs(
      {
        project,
        config: null,
        plugins: [],
        env: {},
        inherited: none,
        cacheDir: "/c" as AbsolutePath,
        emptyConfig: "/c/no-config/pytest.ini" as AbsolutePath,
      },
      CWD,
    );
    expect(own.slice(2, 7)).toEqual([
      "-c",
      "/c/no-config/pytest.ini",
      "--rootdir=/w",
      "--confcutdir=/w",
      "-p",
    ]);
  });
});

describe("refusedFlags (spec 007 D6)", () => {
  it("finds the flags in addopts, PYTEST_ADDOPTS and args, long forms and values included", () => {
    const found = refusedFlags(
      { addopts: ["-q", "--last-failed", "--ff"], envAddopts: ["--lf", "-k", "x"] },
      { ...project, args: ["--snapshot-update", "--pdb"] },
    );
    expect(found).toEqual([
      { flag: "--lf", source: "addopts" },
      { flag: "--ff", source: "addopts" },
      { flag: "--lf", source: "PYTEST_ADDOPTS" },
      { flag: "--snapshot-update", source: "args" },
      { flag: "--pdb", source: "args" },
    ]);
  });

  it("leaves -x, -n, -k, -m and --ds alone, since Squeal overrides or keeps them", () => {
    const kept = {
      addopts: ["-x", "-n", "2", "-m", "not slow", "--ds=s", "-k", "lf"],
      envAddopts: [],
    };
    expect(refusedFlags(kept, project)).toEqual([]);
  });

  it("names every flag and where it was found in one note", () => {
    const note = refusalNote(project, [
      { flag: "--lf", source: "PYTEST_ADDOPTS" },
      { flag: "--sw", source: "pytest" },
    ]);
    expect(note).toContain('pytest project "app"');
    expect(note).toContain("--lf (in PYTEST_ADDOPTS), --sw (in pytest's resolved options)");
  });
});
