import { describe, expect, it } from "vitest";
import type { AbsolutePath, PytestProject, TestFileRef } from "../../../src/core/types/index.js";
import {
  type CommandContext,
  recognizeTestCommand,
  type TestCommand,
} from "../../../src/harness/shared/test-command.js";
import { resolveTestFiles } from "../../../src/harness/shared/test-command-files.js";
import type { PytestHere } from "../../../src/runners/pytest/describe.js";

/* Spec 007 D8 on 005 D8 step 1: each recognized pytest form, and each fall-through. */

const ROOT = "/repo" as AbsolutePath;
const DIR = "/repo/svc" as AbsolutePath;

const SVC: PytestProject = { name: "svc", cwd: "svc", args: [], env: {}, include: ["tests/**"] };

const here = (project: Partial<PytestProject> = {}, env: string | null = `${DIR}/.venv`) =>
  ({ project: { ...SVC, ...project }, dir: DIR, env }) as PytestHere;

const away = (pytest: readonly PytestHere[] = [here()]): CommandContext => ({
  scripts: { test: "vitest run" },
  nodeTest: [],
  pytest,
  atRoot: false,
});

const pytest = (...paths: string[]): TestCommand => ({
  runner: "pytest",
  project: "svc",
  paths: paths.length === 0 ? null : paths.map((p) => `${DIR}/${p}`),
});

describe("recognizeTestCommand, pytest (spec 007 D8)", () => {
  it.each<[string, TestCommand]>([
    ["pytest", pytest()],
    ["python -m pytest", pytest()],
    ["uv run pytest", pytest()],
    [".venv/bin/pytest", pytest()],
    ["./.venv/bin/pytest", pytest()],
    [`${DIR}/.venv/bin/pytest`, pytest()],
    [".venv/bin/python -m pytest", pytest()],
    ["pytest tests/test_a.py", pytest("tests/test_a.py")],
    ["pytest tests", pytest("tests")],
    ["pytest tests/test_a.py::TestA::test_one", pytest("tests/test_a.py")],
    ["pytest 'tests/test_a.py::test_p[1-2]'", pytest("tests/test_a.py")],
    ["pytest tests/test_a.py tests/unit", pytest("tests/test_a.py", "tests/unit")],
    ["pytest -q tests", pytest("tests")],
    ["pytest -v -vv -qq -s -sv tests", pytest("tests")],
    ["pytest -rA -rfE --tb=short tests", pytest("tests")],
    ["uv run pytest --tb=no -q tests/test_a.py", pytest("tests/test_a.py")],
  ])("recognizes %s", (command, expected) => {
    expect(recognizeTestCommand(command, away())).toEqual(expected);
  });

  it.each([
    "pytest tests && echo done",
    "pytest tests; pytest other",
    "pytest tests | tail",
    "cd svc && pytest",
    "PYTHONPATH=src pytest",
    "pytest -k slow",
    "pytest -x tests",
    "pytest --lf",
    "pytest --ff",
    "pytest -n 4",
    "pytest -n0",
    "pytest -p no:cacheprovider",
    "pytest -m 'not slow'",
    "pytest -r",
    "pytest --tb=bogus",
    "pytest --tb short",
    "pytest -- tests",
    "pytest ::test_a",
    "pytest tests/*.py",
    "python3 -m pytest",
    "python -m pytest.main",
    "uv run --frozen pytest",
    "uv run python -m pytest",
    "py.test",
    "other/bin/pytest",
    "venv/bin/python -m pytest",
    "vitest run",
  ])("falls through for %s", (command) => {
    expect(recognizeTestCommand(command, away())).toBeNull();
  });

  it("falls through from a directory no pytest project runs from, or more than one does", () => {
    expect(recognizeTestCommand("pytest", away([]))).toBeNull();
    expect(recognizeTestCommand("pytest", away([here(), here({ name: "other" })]))).toBeNull();
  });

  it("falls through for a project with its own env, which the command lacks", () => {
    expect(recognizeTestCommand("pytest", away([here({ env: { DJANGO: "1" } })]))).toBeNull();
  });

  it("takes the project's own args first, as the config writes them", () => {
    const ds = away([here({ args: ["--ds=settings", "-p", "plug"] })]);
    expect(recognizeTestCommand("pytest --ds=settings -p plug tests", ds)).toEqual(pytest("tests"));
    expect(recognizeTestCommand("pytest tests", ds)).toBeNull();
    expect(recognizeTestCommand("pytest -p plug --ds=settings tests", ds)).toBeNull();
  });

  it("names the environment's pytest only when discovery found one", () => {
    expect(recognizeTestCommand(".venv/bin/pytest", away([here({}, null)]))).toBeNull();
    expect(recognizeTestCommand("pytest", away([here({}, null)]))).toEqual(pytest());
  });

  it("recognizes pytest at the root beside Vitest, and Vitest only there", () => {
    const atRoot: CommandContext = {
      scripts: {},
      nodeTest: [],
      pytest: [
        {
          project: { name: "svc", args: [], env: {}, include: ["tests/**"] },
          dir: ROOT,
          env: null,
        },
      ],
    };
    expect(recognizeTestCommand("pytest tests", atRoot)).toEqual({
      runner: "pytest",
      project: "svc",
      paths: [`${ROOT}/tests`],
    });
    expect(recognizeTestCommand("vitest run", atRoot)).toEqual({ runner: "vitest", filters: [] });
    expect(recognizeTestCommand("vitest run", away())).toBeNull();
  });
});

describe("resolveTestFiles, pytest (spec 007 D8)", () => {
  const ref = (project: string, path: string): TestFileRef => ({ project, path });
  const A = ref("svc", "svc/tests/test_a.py");
  const B = ref("svc", "svc/tests/unit/test_b.py");
  const OTHER = ref("api", "api/tests/test_c.py");
  const VITEST = ref("", "src/math.test.ts");
  const listing = [VITEST, A, OTHER, B];
  const resolve = (command: TestCommand, omitted: number | null = 0) =>
    resolveTestFiles(command, listing, ROOT, new Set(["svc", "api"]), omitted);

  it("does not resolve no path or a directory, whose discovery Squeal cannot prove it covers", () => {
    expect(resolve(pytest())).toBeNull();
    expect(resolve(pytest("tests/unit"))).toBeNull();
    expect(resolve(pytest("tests"))).toBeNull();
    expect(resolve(pytest("."))).toBeNull();
    expect(resolve(pytest("tests/test_a.py", "tests/unit"))).toBeNull();
  });

  it("resolves named files and node IDs' files to the project's listed files", () => {
    expect(resolve(pytest("tests/test_a.py"))).toEqual([A]);
    expect(resolve(pytest("tests/unit/test_b.py", "tests/test_a.py"))).toEqual([A, B]);
    expect(resolve(pytest("tests/test_a.py", "./tests/test_a.py"))).toEqual([A]);
  });

  it("does not resolve a path naming no listed file of the project", () => {
    expect(resolve(pytest("tests/test_missing.py"))).toBeNull();
    expect(resolve(pytest("../api/tests/test_c.py"))).toBeNull();
    expect(resolve(pytest("../../outside.py"))).toBeNull();
    expect(resolve(pytest("tests/test_a.py", "docs"))).toBeNull();
  });

  it("does not resolve a project with no listed file", () => {
    const command = pytest("tests/test_a.py");
    expect(resolveTestFiles(command, [VITEST], ROOT, new Set(["svc"]), 0)).toBeNull();
  });

  it("leaves pytest files out of a Vitest command's", () => {
    expect(resolve({ runner: "vitest", filters: [] })).toEqual([VITEST]);
  });

  it("resolves whatever the listing left out of Vitest's", () => {
    expect(resolve(pytest("tests/test_a.py"), 3)).toEqual([A]);
  });
});
