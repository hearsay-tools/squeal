import { join } from "node:path";
import type { AbsolutePath } from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import type { Pack } from "../driver.js";
import { isTest, type Module } from "../scenarios/index.js";

/**
 * pytest's pack (spec 016 D1) over the declared environment `python`, its
 * runs inheriting `source`: modules in the package `kit`, tests under
 * `tests/`. The package is not `app`, which the environment of the pytest
 * fixtures installs.
 */
export function pytestPack(python: string, source: NodeJS.ProcessEnv): Pack {
  return {
    name: "pytest",
    path: (name, module) => (isTest(module) ? `tests/test_${name}.py` : `kit/${name}.py`),
    text: (module: Module) => {
      switch (module.kind) {
        case "value":
          return `value = ${module.value}\n`;
        case "reexport":
          return `from kit.${module.from} import value\n`;
        case "test":
          return [
            `from kit.${module.from} import value`,
            "",
            "",
            `def test_${module.check}():`,
            `    assert value == ${module.expect}`,
            "",
          ].join("\n");
        case "broken":
          return "value = (\n";
      }
    },
    fullName: (check) => `test_${check}`,
    project: {
      "pyproject.toml": '[tool.pytest.ini_options]\npythonpath = ["."]\n',
      "kit/__init__.py": "",
    },
    open: (root, scratch) =>
      createPytestAdapter(
        { name: "kit", python, args: [], env: {}, include: ["tests/test_*.py"] },
        { root, source, cacheDir: join(scratch, "cache") as AbsolutePath },
      ),
  };
}
