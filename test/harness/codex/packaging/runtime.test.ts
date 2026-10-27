import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Metafile } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bundleOptions,
  copyNodeTestRuntime,
  copyPytestRuntime,
  hookEntries,
  REPO_ROOT,
  rootVersion,
} from "../../../../src/harness/build.js";
import {
  CODEX_DESCRIPTION,
  CODEX_MANIFEST,
  CODEX_PLUGIN_DIR,
  CODEX_RUNTIME,
  CODEX_RUNTIME_DIR,
  CODEX_RUNTIME_DIST,
  CODEX_SETUP_SKILL,
  CODEX_SKILL,
  CODEX_SKILL_NOTE,
  noteCodexCommand,
  runtimeNodeFloor,
  SETUP_SKILL_SOURCE,
  SKILL_SOURCE,
} from "../../../../src/harness/codex/build.js";
import { CODEX_HOOKS } from "../../../../src/harness/codex/index.js";
import {
  createRuntimeManifest,
  REQUIRED_ENTRIES,
  serializeRuntimeManifest,
  validateRuntimeTree,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { STOP_SLOW_HOOK_TIMEOUT_S } from "../../../../src/harness/shared/stop-slow.js";
import { tempDir } from "../../../store/helpers.js";
import { expectSameFiles } from "../../bundle-helpers.js";
import { buildCodexBundles } from "../helpers.js";
import { A, runtimeAt, scratch } from "./fixture.js";

/*
 * Spec 002 D1, D5 and D8 (row 002-31): the routine build of the current
 * Codex runtime, plugins/codex-runtime/, which a release packs and the fixed
 * plugin's adapter runs.
 */

/** The wave-1 contract between 002-12 and 002-13: the entries `hooks.json` names. */
const CONTRACT = [
  "interrupt",
  "post-tool-use",
  "pre-tool-use",
  "session-end",
  "session-start",
  "stop",
  "stop-slow",
  "subagent-start",
  "subagent-stop",
  "user-prompt-submit",
];

/** As the Claude Code drift test: under a loaded full suite the comparison outran 5 s (S3). */
const BUILD = { timeout: 60_000 };

/** The skill as the Codex copy must hold it: its source with the Codex note (002 D1 as amended). */
function expectedSkill(): string {
  const dir = join(tempDir("squeal-codex-skill-"), "squeal");
  cpSync(join(REPO_ROOT, SKILL_SOURCE), dir, { recursive: true });
  noteCodexCommand(dir);
  return dir;
}

let built: Awaited<ReturnType<typeof buildCodexBundles>>;
beforeAll(async () => {
  built = await buildCodexBundles();
}, 60_000);
afterAll(() => built.cleanup());

describe("Codex runtime build (spec 002 D1, D5, D8)", () => {
  it("has one entry per contract event, each a handler", () => {
    expect(hookEntries(CODEX_RUNTIME)).toEqual(CONTRACT);
    expect(Object.keys(CODEX_HOOKS).sort()).toEqual(CONTRACT);
  });

  it("bundles every entry, the runtime entry and the CLI pair beside them", () => {
    for (const name of [...CONTRACT, "runtime"])
      expect(existsSync(join(built.dir, `${name}.mjs`)), name).toBe(true);
    expect(existsSync(join(built.dir, "cli/squeal.mjs"))).toBe(true);
    expect(existsSync(join(built.dir, "cli/front-desk.mjs"))).toBe(true);
    expect(existsSync(join(built.dir, "cli/coverage-map.mjs"))).toBe(true);
  });

  it("gives hook bundles and the runtime entry nothing at runtime but Node built-ins", async () => {
    const result = await build({ ...bundleOptions(CODEX_RUNTIME, tempDir()), write: false });
    const metafile = result.metafile as Metafile;
    const hooks = [...CONTRACT, "runtime"].map((name) => `${name}.mjs`);
    for (const [path, output] of Object.entries(metafile.outputs)) {
      const name = path.split("/").at(-1) ?? "";
      if (!hooks.includes(name)) continue;
      expect(
        Object.keys(output.inputs).filter((input) => input.includes("node_modules")),
        name,
      ).toEqual([]);
      for (const imported of output.imports) expect(imported.path, name).toMatch(/^node:/);
    }
  }, 60_000);

  // Nineteen `node --check` processes in turn: past 5 s under a loaded full suite (task 001-309).
  it("gives every bundle a require for CommonJS dependencies, and each parses (003-12)", () => {
    const files = readdirSync(built.dir, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".mjs") || f.endsWith(".cjs"),
    );
    // dist/node-test/ holds the node:test reporter and recorder, copied verbatim
    // (spec 003 D5): dependency-free, loaded by the project's Node, not bundled.
    // The recorder is CommonJS, the first --require of a test process (003-28).
    // dist/observe/ holds the runtime-input recorder, copied verbatim the same way (001-132),
    // and dist/coverage/ the coverage provider Vitest loads by path (015-11).
    const verbatim = (f: string) =>
      ["node-test/", "observe/", "coverage/"].some((d) => f.startsWith(d));
    const runtime = files.filter(verbatim).sort();
    expect(runtime).toEqual([
      "coverage/provider.mjs",
      "node-test/recorder.cjs",
      "node-test/reporter.mjs",
      "observe/fs.cjs",
      "observe/preloads.cjs",
      "observe/recorder.cjs",
      "observe/spawn.cjs",
    ]);
    for (const file of runtime) execFileSync(process.execPath, ["--check", join(built.dir, file)]);
    const bundles = files.filter((f) => !verbatim(f));
    // The hooks, the runtime entry (002-29), the CLI, its socket worker, `ps` alone (spec 014
    // goal 6), the coverage records' mapping worker (015-42) and the ESLint provider's worker (017-04).
    expect(bundles).toHaveLength(CONTRACT.length + 6);
    for (const file of bundles) {
      const path = join(built.dir, file);
      expect(readFileSync(path, "utf8"), file).toMatch(
        /^(#!.*\n)?import \{ createRequire as __squealCreateRequire \} from "node:module";\nconst require = __squealCreateRequire\(import\.meta\.url\);\n/,
      );
      execFileSync(process.execPath, ["--check", path]);
    }
  }, 60_000);

  it("puts no CLAUDE_* variable name in a hook bundle (D4)", () => {
    for (const name of [...CONTRACT, "runtime"]) {
      expect(readFileSync(join(built.dir, `${name}.mjs`), "utf8"), name).not.toMatch(
        /\bCLAUDE_[A-Z]/,
      );
    }
  });

  it("adds one line to the skill copy, after its title, and changes nothing else", () => {
    const source = readFileSync(join(REPO_ROOT, SKILL_SOURCE, "SKILL.md"), "utf8");
    const copy = readFileSync(join(expectedSkill(), "SKILL.md"), "utf8");
    expect(copy).toBe(source.replace("# Squeal\n", `# Squeal\n\n${CODEX_SKILL_NOTE}\n`));
    expect(CODEX_SKILL_NOTE).toContain(
      '`node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`',
    );
  });

  it("runs the slow wait beside the 2 s Stop, under its long timeout (004 D9 as amended 2026-10-12)", () => {
    const hooks = JSON.parse(readFileSync(join(CODEX_PLUGIN_DIR, "hooks/hooks.json"), "utf8")) as {
      hooks: { Stop: { hooks: { command: string; timeout: number }[] }[] };
    };
    const stop = hooks.hooks.Stop.flatMap((g) => g.hooks);
    expect(stop.map((h) => [h.command.match(/dist\/([a-z-]+)\.mjs/)?.[1], h.timeout])).toEqual([
      ["stop", 2],
      ["stop-slow", STOP_SLOW_HOOK_TIMEOUT_S],
    ]);
  });

  it("is built by `npm run build:plugin` beside the Claude Code plugin", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:plugin"]).toBe(
      "tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts",
    );
  });
});

describe("a runtime built into a scratch directory", () => {
  // Kept for the whole describe: `tempDir` removes its directory after each test.
  const tmp = scratch("sq-codex-runtime-");
  const root = tmp.dir;
  afterAll(() => tmp.cleanup());
  beforeAll(async () => {
    mkdirSync(join(root, "dist", "stale"), { recursive: true });
    writeFileSync(join(root, "dist", "stale", "old.mjs"), "removed by the build\n");
    mkdirSync(join(root, CODEX_SKILL), { recursive: true });
    writeFileSync(join(root, CODEX_SKILL, "stale.md"), "removed by the copy\n");
    await runtimeAt(root, A);
  }, 120_000);

  it("writes the manifest at its version, the skills and the bundles, nothing stale", () => {
    expect(JSON.parse(readFileSync(join(root, CODEX_MANIFEST), "utf8"))).toEqual({
      name: "squeal",
      version: A,
      description: CODEX_DESCRIPTION,
    });
    expectSameFiles(join(root, CODEX_SKILL), expectedSkill());
    expectSameFiles(join(root, CODEX_SETUP_SKILL), join(REPO_ROOT, SETUP_SKILL_SOURCE));
    expect(existsSync(join(root, "dist", "stale"))).toBe(false);
    expect(readFileSync(join(root, "dist", "cli", "squeal.mjs"), "utf8")).toContain(`"${A}"`);
  });

  it("lists every file in a canonical runtime.json with the 22.19.0 floor, every required entry", () => {
    const manifest = validateRuntimeTree(root, { expectedVersion: A });
    expect(manifest.nodeFloor).toBe("22.19.0");
    expect(runtimeNodeFloor()).toBe("22.19.0");
    for (const entry of REQUIRED_ENTRIES) expect(manifest.files[entry], entry).toBeDefined();
    expect(manifest.files["bin/squeal-launcher"]?.mode).toBe(0o755);
  });

  it("round-trips its manifest: recreated from the tree, it serializes to the same bytes", () => {
    const text = readFileSync(join(root, "runtime.json"), "utf8");
    const again = createRuntimeManifest({ root, version: A, nodeFloor: runtimeNodeFloor() });
    expect(serializeRuntimeManifest(again)).toBe(text);
  });
});

/*
 * The coordinator builds and commits plugins/codex-runtime at integration
 * (`tasks/wave-5-contract.md`); until then these fail. From then on a
 * missing or stale runtime fails here, and CI's diff after its build.
 */
describe("committed Codex runtime", () => {
  it("has the bundles exactly as `npm run build:plugin` produces them", BUILD, () => {
    expectSameFiles(CODEX_RUNTIME_DIST, built.dir, ".mjs");
  });

  it("carries the skill exactly as its source in the Claude Code plugin, with the Codex note", () => {
    expectSameFiles(join(CODEX_RUNTIME_DIR, CODEX_SKILL), expectedSkill());
  });

  it("is a complete runtime of the root version, its manifest as the build writes it", () => {
    const manifest = validateRuntimeTree(CODEX_RUNTIME_DIR, { expectedVersion: rootVersion() });
    const again = createRuntimeManifest({
      root: CODEX_RUNTIME_DIR,
      version: rootVersion(),
      nodeFloor: runtimeNodeFloor(),
    });
    expect(serializeRuntimeManifest(again)).toBe(serializeRuntimeManifest(manifest));
  });
});

describe("node:test runtime copy (task 003-13)", () => {
  it("copies the runtime's .mjs and .cjs files into dist/node-test", () => {
    const from = tempDir("squeal-runtime-");
    writeFileSync(join(from, "reporter.mjs"), "export default 1;\n");
    writeFileSync(join(from, "recorder.cjs"), "module.exports = {};\n");
    writeFileSync(join(from, "notes.md"), "not shipped\n");
    const outdir = tempDir("squeal-dist-");
    copyNodeTestRuntime(outdir, from);
    expect(readdirSync(join(outdir, "node-test")).sort()).toEqual(["recorder.cjs", "reporter.mjs"]);
  });

  it("does nothing while the runtime directory does not exist", () => {
    const outdir = tempDir("squeal-dist-");
    copyNodeTestRuntime(outdir, join(outdir, "missing"));
    expect(existsSync(join(outdir, "node-test"))).toBe(false);
  });
});

describe("pytest runtime copy (spec 007 D4, D6)", () => {
  it("copies the runtime's .py files and both .wasm files into dist/pytest, no __pycache__", () => {
    const runtime = tempDir("squeal-pytest-runtime-");
    writeFileSync(join(runtime, "squeal_pytest.py"), "pass\n");
    mkdirSync(join(runtime, "__pycache__"));
    writeFileSync(join(runtime, "__pycache__", "squeal_pytest.cpython-313.pyc"), "");
    const wasmDir = tempDir("squeal-wasm-");
    writeFileSync(join(wasmDir, "a.wasm"), "");
    writeFileSync(join(wasmDir, "b.wasm"), "");
    const outdir = tempDir("squeal-dist-");
    mkdirSync(join(outdir, "pytest"));
    writeFileSync(join(outdir, "pytest", "stale.py"), "");
    copyPytestRuntime(outdir, runtime, [join(wasmDir, "a.wasm"), join(wasmDir, "b.wasm")]);
    expect(readdirSync(join(outdir, "pytest")).sort()).toEqual([
      "a.wasm",
      "b.wasm",
      "squeal_pytest.py",
    ]);
  });

  it("fails the build when a .wasm is missing", () => {
    const outdir = tempDir("squeal-dist-");
    expect(() =>
      copyPytestRuntime(outdir, join(outdir, "none"), [join(outdir, "missing.wasm")]),
    ).toThrow(/missing\.wasm is missing/);
  });
});
