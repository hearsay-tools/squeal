import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parsePython } from "../../../../src/runners/pytest/graph/parse.js";
import { pythonParserReady } from "../../../../src/runners/python/parser.js";

const SMALL = join(import.meta.dirname, "../../../fixtures/pytest/small");

beforeAll(() => pythonParserReady());

const modules = (source: string) => parsePython(source).imports.map((i) => i.module);

describe("parsePython (spec 007 D4)", () => {
  it("reads every import form of the edge-case file, TYPE_CHECKING left out", () => {
    const parsed = parsePython(readFileSync(join(SMALL, "src/app/core.py"), "utf8"));
    expect(
      parsed.imports.map(({ kind, module, level, names, line }) => [
        kind,
        module,
        level,
        names,
        line,
      ]),
    ).toEqual([
      ["from", "__future__", 0, ["annotations"], 1],
      ["import", "importlib", 0, [], 3],
      ["from", "typing", 0, ["TYPE_CHECKING"], 4],
      ["from", "", 1, ["helpers"], 6],
      ["from", "util", 1, ["helper_fn"], 7],
      ["from", "app.util", 0, ["strings"], 8],
      ["import", "app.util.numbers", 0, [], 9],
      ["from", "other", 0, ["add"], 10],
      ["from", "acme.ns", 0, ["mod"], 11],
      ["from", "app", 0, ["fast_impl"], 18],
      ["from", "app", 0, ["slow_impl"], 20],
      ["from", "app", 0, ["lazy"], 24],
      ["dynamic", "app.dyn_literal", 0, [], 29],
      ["dynamic", "app.dunder_literal", 0, [], 30],
    ]);
    expect(parsed.computed).toEqual([35]);
    expect(parsed.errorLine).toBeNull();
  });

  it("skips TYPE_CHECKING bodies however the name is reached, and keeps their else", () => {
    const source = [
      "import typing as t",
      "if t.TYPE_CHECKING:",
      "    import a",
      "elif typing.TYPE_CHECKING:",
      "    import b",
      "else:",
      "    import c",
      "if TYPE_CHECKING:",
      "    import d",
      "def f():",
      "    if TYPE_CHECKING:",
      "        import e",
      "    import g",
    ].join("\n");
    expect(modules(source)).toEqual(["typing", "c", "g"]);
  });

  it("reads aliases, multi-line and parenthesized forms, and leaves strings and comments alone", () => {
    const source = [
      "import a.b as ab, c",
      "from .. import (x,",
      "    y as z)",
      "from ...p.q import *",
      "s = 'import nope'",
      "# import nope2",
      "importlib.import_module('lit' 'eral')",
      "import_module(f'pkg.{name}')",
    ].join("\n");
    const parsed = parsePython(source);
    expect(parsed.imports.map((i) => [i.module, i.level, i.names])).toEqual([
      ["a.b", 0, []],
      ["c", 0, []],
      ["", 2, ["x", "y"]],
      ["p.q", 3, []],
      ["literal", 0, []],
    ]);
    expect(parsed.computed).toEqual([8]);
  });

  it("reads a module-level pytest_plugins literal and flags a computed one", () => {
    expect(parsePython('pytest_plugins = ["a.b", "c"]').pytestPlugins).toEqual(["a.b", "c"]);
    expect(parsePython('pytest_plugins = "a"').pytestPlugins).toEqual(["a"]);
    const computed = parsePython("\npytest_plugins = make()");
    expect([computed.pytestPlugins, computed.pytestPluginsComputed]).toEqual([[], 2]);
  });

  it("parses grammar newer than Python 3.10 and names the first line it cannot parse", () => {
    expect(parsePython('x = f"{f"{1}"}"\nimport a').errorLine).toBeNull();
    expect(parsePython("import a\ndef (:\n").errorLine).toBe(2);
  });
});
