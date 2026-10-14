import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type ImportMode, searchPath } from "../../../../src/runners/pytest/graph/search-path.js";
import { copyFixture, testFilesOf } from "./helpers.js";

/** Spec 007 D4's `sys.path` model: pytest's import modes, `pythonpath`, a `.python-version` pin. */

const { root, cleanup } = copyFixture("small");
afterAll(cleanup);
const modules = testFilesOf(root).map((f) => join(root, f));

function order(importMode: ImportMode, pythonpath: string[] = []): string[] {
  const path = searchPath({
    root,
    cwd: root,
    env: null,
    importMode,
    pythonpath: pythonpath.map((p) => join(root, p)),
    pytestModules: modules,
  });
  return path.locations.map((l) =>
    l.kind === "stdlib" ? "<stdlib>" : relative(root, l.dir) || ".",
  );
}

describe("searchPath (spec 007 D4)", () => {
  it("puts prepend's basedirs first, unless already on the path, then pythonpath and cwd", () => {
    expect(order("prepend")).toEqual(["outcomes", ".", "<stdlib>", "packages/other/src", "src"]);
    expect(order("prepend", ["lib"])).toEqual([
      "outcomes",
      "lib",
      ".",
      "<stdlib>",
      "packages/other/src",
      "src",
    ]);
  });

  it("leaves basedirs out under importlib and puts them last under append", () => {
    expect(order("importlib")).toEqual([".", "<stdlib>", "packages/other/src", "src"]);
    expect(order("append")).toEqual([".", "<stdlib>", "packages/other/src", "src", "outcomes"]);
  });

  it("marks the basedirs pytest inserts, whose order a batch decides, and no other location", () => {
    const marked = (importMode: ImportMode) =>
      searchPath({
        root,
        cwd: root,
        env: null,
        importMode,
        pythonpath: [],
        pytestModules: modules,
      }).locations.flatMap((l) => (l.kind === "dir" && l.basedir ? [relative(root, l.dir)] : []));
    expect(marked("prepend")).toEqual(["outcomes"]);
    expect(marked("append")).toEqual(["outcomes"]);
    expect(marked("importlib")).toEqual([]);
  });

  it("takes the stdlib names of a .python-version pin, else of every measured minor", () => {
    const names = () => {
      const stdlib = searchPath({
        root,
        cwd: root,
        env: null,
        importMode: "prepend",
        pythonpath: [],
        pytestModules: [],
      }).locations.find((l) => l.kind === "stdlib");
      return stdlib?.kind === "stdlib" ? stdlib.names : new Set<string>();
    };
    expect([names().has("distutils"), names().has("_interpchannels")]).toEqual([true, true]);
    writeFileSync(join(root, ".python-version"), "3.13\n");
    expect(names().has("distutils")).toBe(false);
    writeFileSync(join(root, ".python-version"), "3.10\n");
    expect([names().has("distutils"), names().has("_interpchannels")]).toEqual([true, false]);
  });

  it("reads site-packages and .pth paths once pyvenv.cfg exists", () => {
    const env = join(root, ".venv");
    const site = join(env, "lib/python3.13/site-packages");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "_app.pth"), `${join(root, "src")}\n`);
    const at = () =>
      searchPath({
        root,
        cwd: root,
        env,
        importMode: "importlib",
        pythonpath: [],
        pytestModules: [],
      });
    expect(at().source).toBe("derived");
    writeFileSync(join(env, "pyvenv.cfg"), "home = /usr/bin\nversion_info = 3.13.14\n");
    expect(at().source).toBe("environment");
    expect(
      at().locations.map((l) => (l.kind === "stdlib" ? "<stdlib>" : relative(root, l.dir))),
    ).toEqual(["", "<stdlib>", ".venv/lib/python3.13/site-packages", "src"]);
  });
});
