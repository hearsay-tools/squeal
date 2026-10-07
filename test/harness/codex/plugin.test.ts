import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Metafile } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPlugin,
  bundleOptions,
  copyNodeTestRuntime,
  hookEntries,
  REPO_ROOT,
  rootVersion,
} from "../../../src/harness/build.js";
import {
  CODEX_MANIFEST,
  CODEX_PLUGIN,
  CODEX_PLUGIN_DIR,
  CODEX_PLUGIN_DIST,
  CODEX_SKILL,
  SKILL_SOURCE,
} from "../../../src/harness/codex/build.js";
import { CODEX_HOOKS } from "../../../src/harness/codex/index.js";
import { tempDir } from "../../store/helpers.js";
import { expectSameFiles } from "../bundle-helpers.js";
import { buildCodexBundles } from "./helpers.js";

/** The wave-1 contract between 002-12 and 002-13: the entries `hooks.json` names. */
const CONTRACT = [
  "interrupt",
  "post-tool-use",
  "pre-tool-use",
  "session-end",
  "session-start",
  "stop",
  "subagent-start",
  "subagent-stop",
  "user-prompt-submit",
];

let built: Awaited<ReturnType<typeof buildCodexBundles>>;
beforeAll(async () => {
  built = await buildCodexBundles();
}, 60_000);
afterAll(() => built.cleanup());

describe("Codex plugin build (spec 002 D1, D5)", () => {
  it("has one entry per contract event, each a handler", () => {
    expect(hookEntries(CODEX_PLUGIN)).toEqual(CONTRACT);
    expect(Object.keys(CODEX_HOOKS).sort()).toEqual(CONTRACT);
  });

  it("bundles every entry and the CLI pair beside them", () => {
    for (const name of CONTRACT)
      expect(existsSync(join(built.dir, `${name}.mjs`)), name).toBe(true);
    expect(existsSync(join(built.dir, "cli/squeal.mjs"))).toBe(true);
    expect(existsSync(join(built.dir, "cli/front-desk.mjs"))).toBe(true);
  });

  it("gives hook bundles nothing at runtime but Node built-ins", async () => {
    const result = await build({ ...bundleOptions(CODEX_PLUGIN, tempDir()), write: false });
    const metafile = result.metafile as Metafile;
    const hooks = CONTRACT.map((name) => `${name}.mjs`);
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

  it("gives every bundle a require for CommonJS dependencies, and each parses (003-12)", () => {
    const files = readdirSync(built.dir, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".mjs"),
    );
    // dist/node-test/ holds the node:test reporter and recorder, copied verbatim
    // (spec 003 D5): dependency-free, loaded by the project's Node, not bundled.
    const runtime = files.filter((f) => f.startsWith("node-test/")).sort();
    expect(runtime).toEqual(["node-test/recorder.mjs", "node-test/reporter.mjs"]);
    for (const file of runtime) execFileSync(process.execPath, ["--check", join(built.dir, file)]);
    const bundles = files.filter((f) => !f.startsWith("node-test/"));
    expect(bundles).toHaveLength(CONTRACT.length + 2);
    for (const file of bundles) {
      const path = join(built.dir, file);
      expect(readFileSync(path, "utf8"), file).toMatch(
        /^(#!.*\n)?import \{ createRequire as __squealCreateRequire \} from "node:module";\nconst require = __squealCreateRequire\(import\.meta\.url\);\n/,
      );
      execFileSync(process.execPath, ["--check", path]);
    }
  });

  it("puts no CLAUDE_* variable name in a hook bundle (D4)", () => {
    for (const name of CONTRACT) {
      expect(readFileSync(join(built.dir, `${name}.mjs`), "utf8"), name).not.toMatch(
        /\bCLAUDE_[A-Z]/,
      );
    }
  });

  it("writes the root version, copies the skill and builds dist into a plugin directory", async () => {
    const pluginDir = tempDir("squeal-codex-plugin-");
    mkdirSync(join(pluginDir, ".codex-plugin"));
    const manifest = { name: "squeal", version: "0.0.0", description: "kept" };
    writeFileSync(join(pluginDir, CODEX_MANIFEST), JSON.stringify(manifest));
    mkdirSync(join(pluginDir, CODEX_SKILL), { recursive: true });
    writeFileSync(join(pluginDir, CODEX_SKILL, "stale.md"), "removed by the copy");

    await buildPlugin({ ...CODEX_PLUGIN, pluginDir });

    expect(JSON.parse(readFileSync(join(pluginDir, CODEX_MANIFEST), "utf8"))).toEqual({
      ...manifest,
      version: rootVersion(),
    });
    expectSameFiles(join(pluginDir, CODEX_SKILL), join(REPO_ROOT, SKILL_SOURCE));
    expectSameFiles(join(pluginDir, "dist"), built.dir, ".mjs");
  }, 60_000);

  it("skips a manifest that does not exist yet", async () => {
    const pluginDir = tempDir("squeal-codex-plugin-");
    await buildPlugin({ ...CODEX_PLUGIN, pluginDir, copies: [] });
    expect(existsSync(join(pluginDir, CODEX_MANIFEST))).toBe(false);
    expect(existsSync(join(pluginDir, "dist/session-start.mjs"))).toBe(true);
  }, 60_000);

  it("is built by `npm run build:plugin` beside the Claude Code plugin", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:plugin"]).toBe(
      "tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts",
    );
  });
});

describe("node:test runtime copy (task 003-13)", () => {
  it("copies the runtime's .mjs files into dist/node-test", () => {
    const from = tempDir("squeal-runtime-");
    writeFileSync(join(from, "reporter.mjs"), "export default 1;\n");
    writeFileSync(join(from, "recorder.mjs"), "export {};\n");
    writeFileSync(join(from, "notes.md"), "not shipped\n");
    const outdir = tempDir("squeal-dist-");
    copyNodeTestRuntime(outdir, from);
    expect(readdirSync(join(outdir, "node-test")).sort()).toEqual(["recorder.mjs", "reporter.mjs"]);
  });

  it("does nothing while the runtime directory does not exist", () => {
    const outdir = tempDir("squeal-dist-");
    copyNodeTestRuntime(outdir, join(outdir, "missing"));
    expect(existsSync(join(outdir, "node-test"))).toBe(false);
  });
});

/*
 * The coordinator builds and commits plugins/codex/dist at integration, after
 * 002-13 creates the manifest. Until then the plugin does not exist and there
 * is nothing to compare; from then on a missing or stale dist or skill copy
 * fails here (coordinator's reply to 002-12, 2026-10-07).
 */
describe.skipIf(!existsSync(join(CODEX_PLUGIN_DIR, CODEX_MANIFEST)))(
  "committed Codex plugin",
  () => {
    it("has the bundles exactly as `npm run build:plugin` produces them", () => {
      expectSameFiles(CODEX_PLUGIN_DIST, built.dir, ".mjs");
    });

    it("carries the skill exactly as its source in the Claude Code plugin", () => {
      expectSameFiles(join(CODEX_PLUGIN_DIR, CODEX_SKILL), join(REPO_ROOT, SKILL_SOURCE));
    });

    it("has the root version in its manifest", () => {
      const manifest = JSON.parse(readFileSync(join(CODEX_PLUGIN_DIR, CODEX_MANIFEST), "utf8")) as {
        name: string;
        version: string;
      };
      expect(manifest).toMatchObject({ name: "squeal", version: rootVersion() });
    });
  },
);
