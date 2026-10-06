import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { build, type Metafile } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  bundleOptions,
  hookEntries,
  PLUGIN_DIST,
  REPO_ROOT,
} from "../../src/harness/claude-code/build.js";
import { WAITER_HOOK_TIMEOUT_S } from "../../src/harness/claude-code/index.js";
import { tempDir } from "../store/helpers.js";
import { runtimeDir } from "./bundle-helpers.js";

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
      "PreToolUse Edit|Write|NotebookEdit pre-tool-use.mjs ",
      "Stop  stop.mjs ",
      "Stop  waiter.mjs rewake",
      "SubagentStop  stop.mjs ",
      "SessionEnd  session-end.mjs ",
    ]);
  });

  it("runs each bundle under the plugin root with node and no shell", () => {
    for (const { hook } of all) {
      expect(hook.type).toBe("command");
      expect(hook.command).toBe("node");
      expect(hook.args).toHaveLength(2);
      expect(hook.args[0]).toBe("--disable-warning=ExperimentalWarning");
      expect(hook.args[1]).toMatch(/^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/[a-z-]+\.mjs$/);
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
    await build(bundleOptions(outdir));
    const files = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".mjs"))
        .sort();
    expect(files(PLUGIN_DIST)).toEqual(files(outdir));
    for (const file of files(outdir)) {
      expect(readFileSync(join(PLUGIN_DIST, file), "utf8"), file).toBe(
        readFileSync(join(outdir, file), "utf8"),
      );
    }
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
