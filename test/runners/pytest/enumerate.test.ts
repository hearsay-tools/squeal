import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { enumerate, enumerateSource } from "../../../src/runners/pytest/enumerate.js";
import { pythonParserReady } from "../../../src/runners/python/parser.js";

const SMALL = join(import.meta.dirname, "../../fixtures/pytest/small");
const ref = { project: "small", path: "tests/test_x.py" };

beforeAll(() => pythonParserReady());

const names = (source: string, collection = {}) =>
  enumerateSource(source, ref, collection).map((c) => [c.check.fullName, c.templated]);

describe("pytest enumerate (spec 007 D7)", () => {
  it("names the small fixture's tests, the parametrized one templated", async () => {
    const found = await enumerate(join(SMALL, "tests/unit/test_core.py"), {
      project: "small",
      path: "tests/unit/test_core.py",
    });
    expect(found.map((c) => [c.check.fullName, c.templated, c.location?.line])).toEqual([
      ["test_total", true, 8],
      ["test_dynamic", false, 12],
      ["test_computed", false, 15],
      ["test_fixtures", false, 18],
      ["test_data", false, 23],
    ]);
    expect(found[0]?.check).toEqual({
      kind: "test",
      project: "small",
      testPath: "tests/unit/test_core.py",
      fullName: "test_total",
    });
  });

  it("walks classes, nested classes and TestCase subclasses as pytest collects them", () => {
    const source = [
      "import unittest, pytest",
      "def helper(): pass",
      "def test_a(): pass",
      "async def test_b(): pass",
      "class TestOuter:",
      "    def test_m(self): pass",
      "    def other(self): pass",
      "    class TestInner:",
      "        def test_nested(self): pass",
      "    class Helper:",
      "        def test_no(self): pass",
      "class TestWithInit:",
      "    def __init__(self): pass",
      "    def test_no(self): pass",
      "class TestOff:",
      "    __test__ = False",
      "    def test_no(self): pass",
      "class Cases(unittest.TestCase):",
      "    def test_u(self): pass",
      "    def check(self): pass",
      "class TestChild(TestOuter):",
      "    def test_own(self): pass",
      "def test_a(): pass",
    ].join("\n");
    expect(names(source)).toEqual([
      ["test_a", false],
      ["test_b", false],
      ["TestOuter::test_m", false],
      ["TestOuter::TestInner::test_nested", false],
      ["Cases::test_u", false],
      ["TestChild::test_m", false],
      ["TestChild::TestInner::test_nested", false],
      ["TestChild::test_own", false],
    ]);
  });

  it("templates parametrize marks on a function, a class or the module, and computed tests", () => {
    const source = [
      "import pytest",
      "@pytest.mark.parametrize('x', [1, 2])",
      "def test_p(x): pass",
      "@pytest.mark.parametrize('y', [1])",
      "class TestP:",
      "    def test_m(self, y): pass",
      "test_made = make()",
    ].join("\n");
    expect(names(source)).toEqual([
      ["test_p", true],
      ["TestP::test_m", true],
      ["test_made", true],
    ]);
    expect(
      names("import pytest\npytestmark = pytest.mark.parametrize('x', [1])\ndef test_q(x): pass"),
    ).toEqual([["test_q", true]]);
  });

  it("matches python_functions and python_classes as prefixes or globs", () => {
    const source =
      "def check_a(): pass\ndef test_b(): pass\nclass Suite:\n    def check_c(self): pass";
    expect(names(source, { pythonFunctions: ["check"], pythonClasses: ["*Suite"] })).toEqual([
      ["check_a", false],
      ["Suite::check_c", false],
    ]);
  });
});
