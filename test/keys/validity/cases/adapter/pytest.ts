import type { Case, PytestInput, PytestPython } from "../../case.js";

/*
 * The pytest adapter's decisions (011 C14, 007 D2 to D6, row 011-48), each
 * case on both Pythons CI installs: what a run stores (outcomes, a file that
 * fails to collect, a module that skips itself), the closure and the
 * imports a run observes beyond it, the environment and what start-up
 * loads beyond its key (the direction rule's withhold), collection under
 * the config's names, a project with no environment and a refused flag;
 * from task 007-55, the start-up hook of a test's child processes and the
 * file in progress a test sees.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const pytest = (name: string, why: string, input: Omit<PytestInput, "python">): Case[] =>
  (["3.10", "3.13"] as const satisfies readonly PytestPython[]).map((python) => ({
    kind: "adapter:pytest",
    name: `${name}, Python ${python}`,
    why,
    input: { ...input, python },
  }));

const CONFIG = lines("[tool.pytest.ini_options]", 'testpaths = ["tests"]', 'pythonpath = ["."]');

const OUTCOMES: Readonly<Record<string, string>> = {
  "pyproject.toml": CONFIG,
  "tests/test_pass.py": lines("def test_pass():", "    assert True"),
  "tests/test_fail.py": lines(
    "def test_ok():",
    "    pass",
    "",
    "",
    "def test_fails():",
    "    assert 1 == 2",
  ),
  "tests/test_broken.py": lines(
    "import validity_missing_module",
    "",
    "",
    "def test_never():",
    "    pass",
  ),
  "tests/test_phases.py": lines(
    "import pytest",
    "",
    "",
    "@pytest.fixture",
    "def broken_setup():",
    '    raise RuntimeError("setup")',
    "",
    "",
    "@pytest.fixture",
    "def broken_teardown():",
    "    yield",
    '    raise RuntimeError("teardown")',
    "",
    "",
    "def test_setup_error(broken_setup):",
    "    pass",
    "",
    "",
    "def test_teardown_error(broken_teardown):",
    "    pass",
    "",
    "",
    '@pytest.mark.skip(reason="skipped")',
    "def test_skip():",
    "    pass",
    "",
    "",
    "@pytest.mark.xfail",
    "def test_xfail():",
    "    assert False",
    "",
    "",
    "@pytest.mark.xfail",
    "def test_xpass():",
    "    pass",
    "",
    "",
    "@pytest.mark.xfail(strict=True)",
    "def test_strict_xpass():",
    "    pass",
    "",
    "",
    '@pytest.mark.parametrize("n", [1, 2])',
    "def test_param(n):",
    "    assert n < 2",
    "",
    "",
    "class TestGroup:",
    "    def test_method(self):",
    "        pass",
  ),
  // A failure naming the run's own basetemp, which differs at each side: its fingerprint is scrubbed.
  "tests/test_tmp.py": lines("def test_tmp(tmp_path):", '    assert str(tmp_path / "data") == ""'),
  "tests/test_warns.py": lines(
    "import warnings",
    "",
    "",
    "def test_warns():",
    '    warnings.warn("validity", UserWarning)',
  ),
  "tests/test_skipped.py": lines(
    "import pytest",
    "",
    'pytest.skip("the whole module", allow_module_level=True)',
    "",
    "",
    "def test_never():",
    "    pass",
  ),
};

const CLOSURES: Readonly<Record<string, string>> = {
  "pyproject.toml": CONFIG,
  "pkg/__init__.py": "",
  "pkg/a.py": lines("from pkg import b", "", "VALUE = b.VALUE"),
  "pkg/b.py": lines("VALUE = 1"),
  "pkg/dyn.py": lines("VALUE = 2"),
  "pkg/helper.py": lines("HELPER = 3"),
  "pkg/__main__.py": lines("from pkg import cli", "", "cli.main()"),
  "pkg/cli.py": lines("def main():", "    print('cli')"),
  "tests/conftest.py": lines("import pkg.helper"),
  "tests/test_static.py": lines(
    "from pkg import a",
    "",
    "",
    "def test_static():",
    "    assert a.VALUE == 1",
  ),
  "tests/test_dynamic.py": lines(
    "import importlib",
    "",
    "",
    "def test_dynamic():",
    '    module = importlib.import_module(".".join(["pkg", "dyn"]))',
    "    assert module.VALUE == 2",
  ),
  "tests/test_child.py": lines(
    "import subprocess",
    "import sys",
    "",
    "",
    "def test_child():",
    '    subprocess.run([sys.executable, "-m", "pkg"], check=True)',
  ),
};

/**
 * Task 007-55: what the start-up hook of a test's child Python meets. The
 * child imports a module no finder finds, then one only a finder of the old
 * protocol is asked for; one child cannot write its events file; one has a
 * `sitecustomize` after the hook's directory on `PYTHONPATH`, which runs;
 * one is a script that imports nothing (review 0.1.268 B2).
 */
const CHILDREN: Readonly<Record<string, string>> = {
  "pyproject.toml": CONFIG,
  "pkg/__init__.py": "",
  "pkg/child.py": lines(
    "import builtins",
    "import sys",
    "",
    "try:",
    "    import validity_absent_one",
    "except ImportError:",
    "    pass",
    "",
    "",
    "class Old:",
    "    def find_module(self, name, path=None):",
    "        return None",
    "",
    "",
    "sys.meta_path.append(Old())",
    "try:",
    "    import validity_absent_two",
    "except ImportError:",
    "    pass",
    'print(getattr(builtins, "VALIDITY_SITE", "unset"))',
  ),
  "site/sitecustomize.py": lines("import builtins", "", 'builtins.VALIDITY_SITE = "ran"'),
  "tool.py": lines('print("bare")'),
  "tests/test_children.py": lines(
    "import os",
    "import subprocess",
    "import sys",
    "",
    "",
    "def child(**env):",
    "    run = [sys.executable, '-m', 'pkg.child']",
    "    done = subprocess.run(run, capture_output=True, text=True, env={**os.environ, **env})",
    "    assert done.returncode == 0, done.stderr",
    "    return done.stdout",
    "",
    "",
    "def test_child():",
    "    assert child() == 'unset\\n'",
    "",
    "",
    "def test_unwritable_events():",
    "    assert child(SQUEAL_PYTEST_EVENTS=os.path.abspath('missing/events.jsonl')) == 'unset\\n'",
    "",
    "",
    "def test_site_after_the_hook():",
    "    site = os.pathsep + os.path.abspath('site')",
    "    assert child(PYTHONPATH=os.environ['PYTHONPATH'] + site) == 'ran\\n'",
    "",
    "",
    "def test_bare_script():",
    "    done = subprocess.run([sys.executable, 'tool.py'], capture_output=True, text=True)",
    "    assert done.stdout == 'bare\\n', done.stderr",
  ),
};

/** Task 007-55: a test that reads the file in progress, which only 007-55's runtime names. */
const SEES_FILE: Readonly<Record<string, string>> = {
  "pyproject.toml": CONFIG,
  "tests/test_sees_file.py": lines(
    "import os",
    "",
    "",
    "def test_sees_its_file():",
    '    assert os.environ.get("SQUEAL_PYTEST_FILE") == os.path.realpath(__file__)',
  ),
};

const STARTUP: Readonly<Record<string, string>> = {
  "pyproject.toml": lines(
    "[tool.pytest.ini_options]",
    'testpaths = ["tests"]',
    'pythonpath = ["."]',
    'addopts = "-p plugs.early"',
  ),
  "plugs/__init__.py": "",
  "plugs/early.py": lines("import plugs.base", "", "BASE = plugs.base.BASE"),
  "plugs/late.py": lines("LATE = 1"),
  "plugs/extra.py": lines(
    "import pytest",
    "",
    "import plugs.more",
    "",
    'pytest_plugins = ["plugs.more"]',
    "",
    "",
    "@pytest.fixture",
    "def extra():",
    "    return plugs.more.MORE",
  ),
  "plugs/more.py": lines("MORE = 1"),
  "plugs/base.py": lines("BASE = 1"),
  // Named in the project's args, so loaded after the runtime, unlike addopts' -p plugin: its computed import is seen.
  "plugs/later.py": lines(
    "import importlib",
    "",
    'importlib.import_module(".".join(["plugs", "late"]))',
  ),
  "tests/conftest.py": lines('pytest_plugins = "plugs.extra"'),
  "tests/test_one.py": lines("def test_one(extra):", "    assert extra == 1"),
  "tests/test_two.py": lines("def test_two():", "    pass"),
};

/** Collection under `pytest.ini`'s names, which win over `pyproject.toml`'s. */
const NAMES: Readonly<Record<string, string>> = {
  "pyproject.toml": CONFIG,
  "pytest.ini": lines(
    "[pytest]",
    "testpaths = tests",
    "python_files = chec?_[ab]*.py test_*.py",
    "python_classes = Spec*",
    "python_functions = should_* test_*",
    "norecursedirs = skipme",
    "markers =",
    "    slow: deselected by the project's args",
  ),
  "tests/check_alpha.py": lines(
    "import unittest",
    "",
    "import pytest",
    "",
    "",
    "class Cases(unittest.TestCase):",
    "    def test_unit(self):",
    "        pass",
    "",
    "",
    "def should_work():",
    "    pass",
    "",
    "",
    "def helper_not_collected():",
    "    pass",
    "",
    "",
    "class SpecThing:",
    "    def should_hold(self):",
    "        pass",
    "",
    "",
    "class TestNotCollected:",
    "    def test_no(self):",
    "        pass",
    "",
    "",
    '@pytest.mark.parametrize("n", [1, 2])',
    "def test_n(n):",
    "    pass",
  ),
  "tests/check_beta.py": lines(
    "import pytest",
    "",
    'pytestmark = pytest.mark.parametrize("m", [1])',
    "",
    "",
    "def make():",
    "    def should_made(m):",
    "        pass",
    "",
    "    return should_made",
    "",
    "",
    "should_assigned = make()",
    "",
    "",
    "class SpecBase:",
    "    def should_inherited(self, m):",
    "        pass",
    "",
    "",
    "class SpecChild(SpecBase):",
    "    def should_own(self, m):",
    "        pass",
    "",
    "",
    "class SpecOuter:",
    "    class SpecInner:",
    "        def should_nested(self, m):",
    "            pass",
  ),
  "tests/check_gamma.py": lines("def should_not_be_listed():", "    pass"),
  "tests/test_listed.py": lines(
    "import pytest",
    "",
    "",
    "def test_listed():",
    "    pass",
    "",
    "",
    "@pytest.mark.slow",
    "def test_deselected():",
    "    pass",
  ),
  "tests/skipme/test_hidden.py": lines("def test_hidden():", "    pass"),
  "tests/other/test_excluded.py": lines("def test_excluded():", "    pass"),
};

/** A plugin that turns on a flag the runtime refuses where no file names it. */
const FLAGGED: Readonly<Record<string, string>> = {
  "pyproject.toml": lines(
    "[tool.pytest.ini_options]",
    'testpaths = ["tests"]',
    'pythonpath = ["."]',
    'addopts = "-p flags"',
  ),
  "flags.py": lines("def pytest_configure(config):", "    config.option.failedfirst = True"),
  "tests/test_pass.py": lines("def test_pass():", "    assert True"),
};

/**
 * Row 011-144: four checks, one red, one in a nested class, one at top
 * level, of which the texts `new` select three; a file that fails to
 * collect and a module that skips itself, each given texts; a file without
 * texts in the same batch. A tree that does not focus runs every file whole,
 * and the harness compares the selected checks alone.
 */
const FOCUSED: Readonly<Record<string, string>> = {
  "pyproject.toml": CONFIG,
  "tests/test_four.py": lines(
    "class TestParity:",
    "    def test_old_1(self):",
    "        assert True",
    "",
    "    def test_new_1(self):",
    "        assert 1 == 2",
    "",
    "    class TestInner:",
    "        def test_new_2(self):",
    "            assert True",
    "",
    "",
    "def test_new_3_top():",
    "    assert True",
  ),
  "tests/test_broken.py": OUTCOMES["tests/test_broken.py"] ?? "",
  "tests/test_skipped.py": OUTCOMES["tests/test_skipped.py"] ?? "",
  "tests/test_pass.py": OUTCOMES["tests/test_pass.py"] ?? "",
};

export const PYTEST_RUNS: readonly Case[] = [
  ...pytest(
    "a focused run stores the selected checks' outcomes as a whole run does (row 011-144)",
    "011 C14 and 007 D6 as amended 2026-10-23: squeal_pytest deselects every item whose full name holds no text, so the selected checks, a collection error and a module skip read as in a whole run, beside a file without texts; the focused tier stores nothing (C4), and this pins that the deselection changes no outcome it selects",
    {
      files: FOCUSED,
      runs: [
        {
          files: [
            "tests/test_broken.py",
            "tests/test_four.py",
            "tests/test_pass.py",
            "tests/test_skipped.py",
          ],
          checks: [
            { path: "tests/test_four.py", texts: ["new", "TestInner::"] },
            { path: "tests/test_broken.py", texts: ["never"] },
            { path: "tests/test_skipped.py", texts: ["test_"] },
          ],
        },
      ],
    },
  ),
  ...pytest(
    "outcomes, a file that fails to collect and a module that skips itself",
    "007 D2 and D6: each phase's outcome, a failure's fingerprint, a collection error's and a module-level skip are what the scheduler stores for each file; the environment is the worktree's .venv",
    {
      files: OUTCOMES,
      venv: true,
      runs: [
        {
          files: [
            "tests/test_broken.py",
            "tests/test_fail.py",
            "tests/test_pass.py",
            "tests/test_phases.py",
            "tests/test_skipped.py",
            "tests/test_tmp.py",
            "tests/test_warns.py",
          ],
        },
      ],
    },
  ),
  ...pytest(
    "a closure, the imports a run observes beyond it, and a child python -m",
    "007 D4 and D6: the static closure and an observed computed import key a file; what an edit of each module reaches re-keys it; an edit, an add, a touch and a delete move the graph and the listing; 007-55 adds what a child Python imports",
    {
      files: CLOSURES,
      affected: ["pkg/b.py", "pkg/dyn.py", "pkg/cli.py", "pkg/helper.py"],
      runs: [
        { files: ["tests/test_child.py", "tests/test_dynamic.py", "tests/test_static.py"] },
        {
          edits: [
            { path: "pkg/extra.py", text: lines("VALUE = 1") },
            { path: "pkg/b.py", text: lines("from pkg import extra", "", "VALUE = extra.VALUE") },
            { path: "pkg/helper.py" },
            { path: "tests/test_child.py", text: null },
            {
              path: "tests/test_added.py",
              text: lines(
                "from pkg import b",
                "",
                "",
                "def test_added():",
                "    assert b.VALUE == 1",
              ),
            },
          ],
          files: ["tests/test_added.py", "tests/test_static.py"],
        },
      ],
    },
  ),
  ...pytest(
    "a child Python's failed imports, an old-protocol finder, an unwritable events file, a sitecustomize after the hook and a bare script",
    "007 D6 as amended by 007-55: the start-up hook of a process a test starts asks the finders after it, returns nothing for a module none finds or where an old-protocol finder stands, never fails the child when its events file cannot be written, runs the sitecustomize it shadows, and records at start-up the script `python tool.py` runs, which imports nothing (review 0.1.268 B2)",
    { files: CHILDREN, runs: [{ files: ["tests/test_children.py"] }] },
  ),
  ...pytest(
    "a test sees its own file in SQUEAL_PYTEST_FILE while it runs",
    "007 D6 as amended by 007-55, the case that stands for PYTEST_ADAPTER_VERSION 3. Observable: a test's environment holds SQUEAL_PYTEST_FILE, its own file, while it runs, so under one key a test that reads it stores a pass where the last release stored a fail. The reason for the raise: a result stored before 007-55 sits at a key whose closure lacks what the test's child processes import, and a closure gains those paths only after a run here, which this kind reads as keys; without the raise such a result, an E9-style false pass among them, would stay current until its file ran again",
    { files: SEES_FILE, runs: [{ files: ["tests/test_sees_file.py"] }] },
  ),
  ...pytest(
    "a start-up import beyond the key withholds the files, then joins the environment",
    "007 D2 and D6 (B5): a -p plugin's closure and a root conftest's computed import at start-up are environment files; a run that loaded one its key lacked stores nothing for its files, and the next run, keyed with it, stores them",
    {
      files: STARTUP,
      project: { args: ["-p", "plugs.later"] },
      affected: ["plugs/late.py", "plugs/base.py", "plugs/extra.py"],
      runs: [
        { files: ["tests/test_one.py", "tests/test_two.py"] },
        { files: ["tests/test_one.py", "tests/test_two.py"] },
      ],
    },
  ),
  ...pytest(
    "collection under the config's names, norecursedirs, the policy's exclude and a deselecting -m",
    "007 D3 and D6: which files are test files and which checks each holds and runs decide the rows a run stores",
    {
      files: NAMES,
      project: {
        include: ["tests/**/*.py"],
        exclude: ["tests/other/**"],
        args: ["-m", "not slow"],
      },
      runs: [{ files: ["tests/check_alpha.py", "tests/check_beta.py", "tests/test_listed.py"] }],
    },
  ),
  {
    kind: "adapter:pytest",
    name: "a project with no environment runs nothing",
    why: "007 D2 and D4: a project without an environment keys its runner as unavailable and stores nothing; its closures come from the import roots its pyproject.toml derives",
    input: {
      python: "3.13",
      files: {
        "pyproject.toml": lines(
          "[project]",
          'name = "app"',
          'version = "0"',
          "",
          "[build-system]",
          'requires = ["hatchling"]',
          'build-backend = "hatchling.build"',
          "",
          "[tool.hatch.build.targets.wheel]",
          'packages = ["src/app"]',
          "",
          "[tool.pytest.ini_options]",
          'testpaths = ["tests"]',
        ),
        "src/app/__init__.py": "",
        "src/app/core.py": lines("VALUE = 1"),
        "tests/test_app.py": lines(
          "from app import core",
          "",
          "",
          "def test_app():",
          "    assert core.VALUE == 1",
        ),
      },
      project: { python: "missing/.venv" },
      runs: [{ files: ["tests/test_app.py"] }],
    },
  },
  {
    kind: "adapter:pytest",
    name: "a refused flag in addopts runs nothing",
    why: "007 D6: a flag that changes what runs (--lf) refuses the run, which stores nothing",
    input: {
      python: "3.13",
      files: {
        "pyproject.toml": lines(
          "[tool.pytest.ini_options]",
          'testpaths = ["tests"]',
          'addopts = "--lf"',
        ),
        "tests/test_pass.py": OUTCOMES["tests/test_pass.py"] ?? "",
      },
      runs: [{ files: ["tests/test_pass.py"] }],
    },
  },
  ...pytest(
    "a plugin that turns on a refused flag runs nothing",
    "007 D6: the runtime refuses a flag that changes what runs wherever it was set, and the run stores nothing",
    { files: FLAGGED, runs: [{ files: ["tests/test_pass.py"] }] },
  ),
  {
    kind: "adapter:pytest",
    name: "a batch past Squeal's deadline completes nothing after the kill",
    why: "007 D6: a batch killed on the deadline stores only what completed before it",
    input: {
      python: "3.13",
      files: {
        "pyproject.toml": CONFIG,
        "tests/test_first.py": lines("def test_first():", "    pass"),
        "tests/test_hang.py": lines(
          "import time",
          "",
          "",
          "def test_hang():",
          "    time.sleep(600)",
        ),
      },
      runs: [{ files: ["tests/test_first.py", "tests/test_hang.py"], timeoutMs: 3_000 }],
    },
  },
];
