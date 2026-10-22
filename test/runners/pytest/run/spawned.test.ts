import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { pytestRuntimeDir } from "../../../../src/runners/pytest/run/run.js";
import { type Found, findPython, PYTHONS, pythonEnv } from "../../../helpers/pytest-env.js";

/*
 * Task 007-55: `sitecustomize.py`, the start-up hook of every Python process
 * a test starts, run by a bare managed interpreter over a temp project. With
 * `SQUEAL_PYTEST_FILE` set, a process records each project file it finds to
 * import, and the script it runs, under that test file; without it, it only
 * runs the `sitecustomize` it shadows.
 */

const runtime = pytestRuntimeDir();
const FILES: Readonly<Record<string, string>> = {
  "pkg/__init__.py": "",
  "pkg/__main__.py": "from pkg.cli import main\n\nraise SystemExit(main())\n",
  "pkg/cli.py": [
    "import json",
    "",
    "try:",
    "    import pkg.broken",
    "except RuntimeError:",
    "    pass",
    "",
    "",
    "def main():",
    '    print(json.dumps("ran"))',
    "    return 0",
    "",
  ].join("\n"),
  "pkg/broken.py": 'raise RuntimeError("broken on import")\n',
  "pkg/unused.py": "",
  "tool.py": "import pkg\n",
  "bare.py": 'print("ok")\n',
  "tests/test_cli.py": "",
  "site/sitecustomize.py": 'import builtins\n\nbuiltins.FIXTURE_SITECUSTOMIZE = "ran"\n',
};

interface Spawned {
  readonly type: string;
  readonly to: string;
  readonly ctx: string;
  readonly pid: number;
}

describe.each(PYTHONS)("the start-up hook under Python %s (task 007-55)", (version) => {
  let found: Found = { ok: false, reason: "not looked up" };
  let root = "";
  let runs = 0;
  beforeAll(() => {
    found = findPython(version);
    root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-spawned-")));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  });
  afterAll(() => {
    if (root !== "") rmSync(root, { recursive: true, force: true });
  });

  /** Runs the interpreter in `root` with the hook on `PYTHONPATH`; `file` sets the test file in progress. */
  function python(
    ctx: TestContext,
    args: readonly string[],
    options: { file?: string; pythonpath?: readonly string[] } = {},
  ) {
    if (!found.ok) {
      if (process.env.CI) throw new Error(`Python ${version} unavailable on CI: ${found.reason}`);
      return ctx.skip(found.reason);
    }
    const events = join(root, `events-${runs++}.jsonl`);
    const stdout = execFileSync(found.python, args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...pythonEnv(),
        PYTHONPATH: [runtime, ...(options.pythonpath ?? [])].join(":"),
        SQUEAL_PYTEST_EVENTS: events,
        SQUEAL_PYTEST_ROOT: root,
        ...(options.file === undefined ? {} : { SQUEAL_PYTEST_FILE: join(root, options.file) }),
      },
    });
    const records: Spawned[] = existsSync(events)
      ? readFileSync(events, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Spawned)
      : [];
    return { stdout, records, recorded: records.map((r) => r.to.slice(root.length + 1)).sort() };
  }

  it("records what `python -m pkg` finds under the test file, a module that raises on import too", (ctx) => {
    const { stdout, records, recorded } = python(ctx, ["-m", "pkg"], { file: "tests/test_cli.py" });
    expect(stdout).toBe('"ran"\n');
    // The stdlib's `json` and the interpreter's own files are outside the root; `unused.py` was never asked for.
    expect(recorded).toEqual(["pkg/__init__.py", "pkg/__main__.py", "pkg/broken.py", "pkg/cli.py"]);
    expect(new Set(records.map((r) => r.type))).toEqual(new Set(["spawned"]));
    expect(new Set(records.map((r) => r.ctx))).toEqual(new Set([join(root, "tests/test_cli.py")]));
    expect(new Set(records.map((r) => r.pid)).size).toBe(1);
  });

  it("records the script `python tool.py` runs", (ctx) => {
    const { recorded } = python(ctx, ["tool.py"], { file: "tests/test_cli.py" });
    expect(recorded).toEqual(["pkg/__init__.py", "tool.py"]);
  });

  it("records a script that imports nothing, which asks no finder (review 0.1.268 B2)", (ctx) => {
    const { stdout, recorded } = python(ctx, ["bare.py"], { file: "tests/test_cli.py" });
    expect(stdout).toBe("ok\n");
    expect(recorded).toEqual(["bare.py"]);
    // `python -c` names no file in `sys.argv[0]`.
    expect(python(ctx, ["-c", "pass"], { file: "tests/test_cli.py" }).records).toEqual([]);
  });

  it("without SQUEAL_PYTEST_FILE writes nothing and imports nothing beyond importlib.machinery", (ctx) => {
    const list = "import sys; print(' '.join(sorted(sys.modules)))";
    const { stdout, records } = python(ctx, ["-c", list]);
    expect(records).toEqual([]);
    const bare = execFileSync(found.ok ? found.python : "", ["-c", list], {
      encoding: "utf8",
      env: pythonEnv(),
    });
    const plain = new Set(bare.trim().split(" "));
    const added = stdout
      .trim()
      .split(" ")
      .filter((m) => !plain.has(m));
    // 3.10's `importlib` imports `warnings`.
    const allowed = [
      "importlib",
      "importlib._bootstrap",
      "importlib._bootstrap_external",
      "importlib.machinery",
      "sitecustomize",
      "warnings",
    ];
    expect(added.filter((m) => !allowed.includes(m))).toEqual([]);
  });

  it("runs the sitecustomize it shadows, with the variable and without it", (ctx) => {
    const check =
      "import builtins, sys; print(builtins.FIXTURE_SITECUSTOMIZE, sys.modules['sitecustomize'].__file__)";
    const shadowed = `ran ${join(root, "site/sitecustomize.py")}\n`;
    const site = [join(root, "site")];
    expect(python(ctx, ["-c", check], { pythonpath: site }).stdout).toBe(shadowed);
    const recording = python(ctx, ["-c", `import pkg; ${check}`], {
      file: "tests/test_cli.py",
      pythonpath: site,
    });
    expect(recording.stdout).toBe(shadowed);
    expect(recording.recorded).toEqual(["pkg/__init__.py"]);
    // The hook's directory twice on `PYTHONPATH` still runs the shadowed one, once.
    const twice = python(ctx, ["-c", `import pkg; ${check}`], {
      file: "tests/test_cli.py",
      pythonpath: [runtime, ...site],
    });
    expect(twice.stdout).toBe(shadowed);
    expect(twice.recorded).toEqual(["pkg/__init__.py"]);
  });
});
