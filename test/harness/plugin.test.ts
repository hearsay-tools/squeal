import { execFileSync } from "node:child_process";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Metafile } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildDist } from "../../src/harness/build.js";
import {
  bundleOptions,
  CLAUDE_CODE_PLUGIN,
  hookEntries,
  PLUGIN_DIST,
  REPO_ROOT,
  VERSIONED_PLUGIN_FILES,
  writePluginVersions,
} from "../../src/harness/claude-code/build.js";
import { WAITER_HOOK_TIMEOUT_S } from "../../src/harness/claude-code/index.js";
import { tempDir } from "../store/helpers.js";
import { expectSameFiles, runtimeDir } from "./bundle-helpers.js";

const PLUGIN = join(REPO_ROOT, "plugins/claude-code");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(PLUGIN, path), "utf8"));

interface HookCommand {
  readonly type: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly timeout: number;
  readonly asyncRewake?: boolean;
}
interface HookGroup {
  readonly matcher?: string;
  readonly hooks: readonly HookCommand[];
}
const hooksJson = readJson("hooks/hooks.json") as { hooks: Record<string, HookGroup[]> };
const DIST = `\${CLAUDE_PLUGIN_ROOT}/dist/`;
const bundleOf = (h: HookCommand) => h.args.at(-1)?.replace(DIST, "");

describe("hooks/hooks.json", () => {
  const all = Object.entries(hooksJson.hooks).flatMap(([event, groups]) =>
    groups.flatMap((g) => g.hooks.map((h) => ({ event, matcher: g.matcher, hook: h }))),
  );

  it("registers the D9 events and their bundles", () => {
    const table = all.map(({ event, matcher, hook }) =>
      [event, matcher ?? "", bundleOf(hook), hook.asyncRewake === true ? "rewake" : ""].join(" "),
    );
    expect(table).toEqual([
      "SessionStart  session-start.mjs ",
      "SessionStart  waiter.mjs rewake",
      "SubagentStart  session-start.mjs ",
      // Defect 10 (task 001-47): an interrupted turn runs no Stop, so every prompt re-arms.
      "UserPromptSubmit  user-prompt-submit.mjs ",
      "UserPromptSubmit  waiter.mjs rewake",
      "PostToolBatch  post-tool-batch.mjs ",
      // Task 001-93: every tool call, so a turn another Stop hook continued is a turn again.
      "PreToolUse  pre-tool-use.mjs ",
      "Stop  stop.mjs ",
      "Stop  waiter.mjs rewake",
      "SubagentStop  stop.mjs ",
      "SessionEnd  session-end.mjs ",
    ]);
  });

  it("runs each bundle under the plugin root with node, the per-tool hooks behind sh", () => {
    // Task 001-93: hooks that fire per tool call first test for Squeal in sh (fast-path.test.ts).
    const PER_TOOL = new Set(["PreToolUse", "PostToolBatch"]);
    for (const { event, hook } of all) {
      expect(hook.type).toBe("command");
      const node = PER_TOOL.has(event) ? hook.args.slice(3) : [hook.command, ...hook.args];
      expect(hook.command, event).toBe(PER_TOOL.has(event) ? "sh" : "node");
      expect(node, event).toHaveLength(3);
      expect(node.slice(0, 2)).toEqual(["node", "--disable-warning=ExperimentalWarning"]);
      expect(node[2]).toMatch(/^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/[a-z-]+\.mjs$/);
      expect(existsSync(join(PLUGIN, "dist", bundleOf(hook) ?? ""))).toBe(true);
    }
  });

  it("gives every synchronous hook timeout 2 and the waiter an explicit long one", () => {
    for (const { hook } of all) {
      expect(hook.timeout).toBe(hook.asyncRewake === true ? WAITER_HOOK_TIMEOUT_S : 2);
    }
  });
});

describe("plugin manifest", () => {
  it("keeps the plugin, its marketplace entry and both package versions in step", () => {
    const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const plugin = readJson(".claude-plugin/plugin.json") as { name: string; version: string };
    const pkg = readJson("package.json") as { version: string; type: string };
    // Review wave 3, S4: a github marketplace resolves plugin sources against the clone root.
    const marketplace = JSON.parse(
      readFileSync(join(REPO_ROOT, ".claude-plugin/marketplace.json"), "utf8"),
    ) as { name: string; plugins: { name: string; source: string }[] };
    expect(plugin.version).toBe(root.version);
    expect(pkg).toMatchObject({ version: root.version, type: "module" });
    expect(marketplace.name).toBe("squeal");
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: plugin.name, source: "./plugins/claude-code" }),
    ]);
    expect(existsSync(join(PLUGIN, ".claude-plugin/marketplace.json"))).toBe(false);
    // 001-76: the manifest's version decides updates and wins over the entry's; one place only.
    expect(marketplace.plugins[0]).not.toHaveProperty("version");
  });

  it("gets its version written by the build from the root package (001-76)", () => {
    const dir = tempDir("squeal-plugin-version-");
    mkdirSync(join(dir, ".claude-plugin"));
    for (const file of VERSIONED_PLUGIN_FILES) copyFileSync(join(PLUGIN, file), join(dir, file));
    writePluginVersions(dir, "9.8.7");
    for (const file of VERSIONED_PLUGIN_FILES) {
      const written = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
      expect(written, file).toEqual({ ...(readJson(file) as object), version: "9.8.7" });
    }
  });

  it("puts an executable squeal on the plugin path that runs the bundled CLI", () => {
    const bin = join(PLUGIN, "bin/squeal");
    accessSync(bin, constants.X_OK);
    const version = execFileSync(bin, ["--version"], { encoding: "utf8" });
    expect(version).toBe(`${(readJson("package.json") as { version: string }).version}\n`);
  });
});

describe("bundles", () => {
  it("are committed exactly as `npm run build` produces them", async () => {
    const outdir = tempDir("squeal-bundles-");
    await buildDist(CLAUDE_CODE_PLUGIN, outdir);
    expectSameFiles(PLUGIN_DIST, outdir, ".mjs");
  });

  it("give the CLI the root version with no manifest anywhere near it (B1)", () => {
    // Under /tmp: the OS temp dir can sit inside a checkout of this repository.
    const dir = runtimeDir();
    copyFileSync(join(PLUGIN_DIST, "cli/squeal.mjs"), join(dir, "squeal.mjs"));
    const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const out = execFileSync(process.execPath, [join(dir, "squeal.mjs"), "--version"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(out).toBe(`${root.version}\n`);
  });

  it("ship the daemon's socket worker beside the CLI (B1)", () => {
    expect(existsSync(join(PLUGIN_DIST, "cli/front-desk.mjs"))).toBe(true);
  });

  it("load Vitest and @parcel/watcher only from the project, never statically (B2, N11)", async () => {
    const result = await build({ ...bundleOptions(tempDir("squeal-bundles-")), write: false });
    const metafile = result.metafile as Metafile;
    for (const [path, output] of Object.entries(metafile.outputs)) {
      const packages = output.imports
        .filter((i) => !i.path.startsWith("node:"))
        .map((i) => `${i.kind} ${i.path}`);
      // Squeal's own @parcel/watcher is tried first, lazily; the project's is the fallback.
      const allowed = path.endsWith("cli/squeal.mjs") ? ["dynamic-import @parcel/watcher"] : [];
      expect(packages, path).toEqual(allowed);
    }
  });

  it("need nothing at runtime but Node built-ins", async () => {
    const result = await build({ ...bundleOptions(tempDir("squeal-bundles-")), write: false });
    const metafile = result.metafile as Metafile;
    // The CLI bundle carries the daemon and therefore the pure-JS watcher dependency; the hook
    // entry points must stay dependency-free, so the assertion is per hook output.
    const hooks = hookEntries().map((name) => `${name}.mjs`);
    for (const [path, output] of Object.entries(metafile.outputs)) {
      const name = path.split("/").at(-1) ?? "";
      if (!hooks.includes(name)) continue;
      expect(
        Object.keys(output.inputs).filter((input) => input.includes("node_modules")),
        name,
      ).toEqual([]);
      for (const imported of output.imports) expect(imported.path, name).toMatch(/^node:/);
    }
  });
});
