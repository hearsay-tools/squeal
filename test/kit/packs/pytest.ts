import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AbsolutePath, PytestProject } from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import type { Fixture, Pack } from "../driver.js";
import { isTest, type Module, type Written } from "../scenarios/index.js";

/*
 * pytest's pack (spec 016 D1) over the declared environment `python`, its
 * runs inheriting `source`: modules in the package `kit`, tests under
 * `tests/`, a dependency installed in the environment's site-packages with
 * its `.dist-info`, outside the worktree. A startup hook is a `-p` plugin;
 * its variant is a `conftest.py` at the root (007 wave 2 B5).
 */

/** What a startup hook shares with every test. */
const SHARED = "builtins.kit_value";

function test(module: Extract<Written, { kind: "test" }>, of: (name: string) => Module): string {
  const from = of(module.from);
  const check = `def test_${module.check}():`;
  if (from.kind === "hook") {
    return ["import builtins", "", "", check, `    assert ${SHARED} == ${module.expect}`].join(
      "\n",
    );
  }
  const where = from.kind === "dependency" ? module.from : `kit.${module.from}`;
  return [`from ${where} import value`, "", "", check, `    assert value == ${module.expect}`].join(
    "\n",
  );
}

function text(module: Written, of: (name: string) => Module): string {
  switch (module.kind) {
    case "value":
    case "dependency":
      return `value = ${module.value}\n`;
    case "reexport":
      return `from kit.${module.from} import value\n`;
    case "test":
      return `${test(module, of)}\n`;
    case "computed":
      return [
        "import importlib",
        "",
        "",
        `def test_${module.check}():`,
        `    module = importlib.import_module(".".join(["kit", "${module.from}"]))`,
        `    assert module.value == ${module.expect}`,
        "",
      ].join("\n");
    case "hook":
      return [
        "import builtins",
        "import importlib",
        "",
        `${SHARED} = importlib.import_module(".".join(["kit", "${module.from}"])).value`,
        "",
      ].join("\n");
    case "held":
      return [
        "import time",
        "from pathlib import Path",
        "",
        "",
        `def test_${module.check}():`,
        "    pass",
        "",
        "",
        `def test_${module.holds}():`,
        `    (Path(__file__).parent.parent / "${module.holds}.started").write_text("")`,
        "    time.sleep(600)",
        "",
      ].join("\n");
    case "broken":
      return "value = (\n";
  }
}

/** The environment's site-packages: `<env>/lib/python3.X/site-packages`. */
function sitePackages(python: string): string {
  const lib = join(dirname(dirname(python)), "lib");
  const version = readdirSync(lib).find((name) => name.startsWith("python"));
  if (version === undefined) throw new Error(`${lib} holds no python3.X directory`);
  return join(lib, version, "site-packages");
}

/** The plugin module of a hook at `path`, `kit/setup.py`: `kit.setup`. */
const moduleOf = (path: string) => path.replace(/\.py$/, "").split("/").join(".");

/**
 * pytest's pack over the declared environment `python`, its runs
 * inheriting `source`.
 */
export function pytestPack(python: string, source: NodeJS.ProcessEnv): Pack {
  const project: PytestProject = {
    name: "kit",
    python,
    args: [],
    env: {},
    include: ["tests/test_*.py"],
  };
  const opener =
    (plugins: (hooks: readonly string[]) => readonly string[]) =>
    (root: AbsolutePath, scratch: AbsolutePath, { hooks }: Fixture) =>
      createPytestAdapter(
        { ...project, args: plugins(hooks) },
        { root, source, cacheDir: join(scratch, "cache") as AbsolutePath },
      );
  const path = (name: string, module: Module) => {
    if (isTest(module)) return `tests/test_${name}.py`;
    if (module.kind === "dependency") return join(sitePackages(python), name, "__init__.py");
    return `kit/${name}.py`;
  };
  const base: Pack = {
    name: "pytest",
    path,
    text,
    beside: (name, module) =>
      module.kind === "dependency"
        ? {
            [join(sitePackages(python), `${name}-${module.value}.0.dist-info`, "METADATA")]:
              `Metadata-Version: 2.1\nName: ${name}\nVersion: ${module.value}.0\n`,
          }
        : {},
    fullName: (check) => `test_${check}`,
    project: {
      "pyproject.toml": '[tool.pytest.ini_options]\npythonpath = ["."]\n',
      "kit/__init__.py": "",
    },
    open: opener((hooks) => hooks.flatMap((hook) => ["-p", moduleOf(hook)])),
  };
  return {
    ...base,
    variants: [
      {
        name: "conftest.py",
        scenarios: ["K5"],
        pack: {
          ...base,
          name: "pytest conftest.py",
          path: (name, module) => (module.kind === "hook" ? "conftest.py" : path(name, module)),
          open: opener(() => []),
        },
      },
    ],
  };
}
