import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPytestConfig } from "../../../../src/runners/pytest/environment/config.js";
import {
  configArgs,
  readConfigValue,
  shellSplit,
} from "../../../../src/runners/pytest/environment/config-values.js";
import { tempDir, write } from "./tree.js";

/*
 * Spec 007 D1: the config's `addopts` and the other keys D3 and D6 read,
 * as pytest 9.1.1's `load_config_dict_from_file` gives them: ini mode as
 * strings (lists kept from a TOML `ini_options`), TOML mode as native values.
 */

function value(files: Record<string, string>, key: string) {
  const root = tempDir();
  write(root, files);
  const config = findPytestConfig(root, root);
  if (config === null) throw new Error("no config");
  return readConfigValue(config, key);
}

describe("readConfigValue (spec 007 D1)", () => {
  it.each([
    [{ "pytest.ini": "[pytest]\naddopts = -x\n  --lf\n# note\n" }, "-x\n--lf"],
    [{ "pytest.ini": "[pytest]\naddopts: -x # kept\n" }, "-x # kept"],
    [{ "tox.ini": "[tox]\naddopts = no\n\n[pytest]\naddopts = -q\n" }, "-q"],
    [{ "setup.cfg": "[metadata]\nname = a\n\n[tool:pytest]\naddopts = -n 2\n" }, "-n 2"],
    [{ "pyproject.toml": "[tool.pytest.ini_options]\naddopts = '-x'\n" }, "-x"],
    [
      { "pyproject.toml": "[tool.pytest.ini_options]\naddopts = ['-x', '-n', '2']\n" },
      ["-x", "-n", "2"],
    ],
    [{ "pyproject.toml": "[tool.pytest.ini_options]\nminversion = 8\n" }, undefined],
    [{ "pyproject.toml": "[tool.pytest]\naddopts = ['-x']\n" }, ["-x"]],
    [{ "pytest.toml": "[pytest]\naddopts = ['--lf']\n" }, ["--lf"]],
    [{ "pyproject.toml": "[project]\nname = 'a'\n" }, undefined],
  ])("reads addopts from %j", (files, expected) => {
    expect(value(files, "addopts")).toEqual(expected);
  });

  it("turns an ini-mode TOML scalar into a string, as pytest does", () => {
    expect(
      value({ "pyproject.toml": "[tool.pytest.ini_options]\nminversion = 8\n" }, "minversion"),
    ).toBe("8");
  });

  it("reads nothing from a TOML file pytest cannot parse", () => {
    expect(value({ "pytest.toml": "[pytest\n" }, "addopts")).toBeUndefined();
  });

  it("reads nothing from the fallback pyproject.toml", () => {
    const root = tempDir();
    write(root, { "pyproject.toml": "[tool.other]\naddopts = '-x'\n" });
    const config = findPytestConfig(root, root);
    expect(config?.holds).toBe("fallback");
    expect(config && readConfigValue(config, "addopts")).toBeUndefined();
    expect(join(root, "pyproject.toml")).toBe(config?.path);
  });
});

describe("configArgs and shellSplit", () => {
  it.each([
    ["-x --maxfail 2", ["-x", "--maxfail", "2"]],
    ["-k 'a and b' -m \"not slow\"", ["-k", "a and b", "-m", "not slow"]],
    ['"a \\" b" c\\ d', ['a " b', "c d"]],
    ["-x\n--lf", ["-x", "--lf"]],
    ["''", [""]],
    ["'open", null],
  ])("splits %j as shlex.split", (text, expected) => {
    expect(shellSplit(text)).toEqual(expected);
  });

  it("keeps a list, refuses other TOML values and reads absence as none", () => {
    expect(configArgs(["-x", "-q"])).toEqual(["-x", "-q"]);
    expect(configArgs(3)).toBeNull();
    expect(configArgs(undefined)).toEqual([]);
  });
});
