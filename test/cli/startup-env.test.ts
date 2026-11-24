import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/build.js";
import { tempDir } from "../store/helpers.js";

/*
 * Spec 025 D7: the shell hook runners and CLI launchers start Node without
 * NODE_USE_ENV_PROXY's proxy setup and put the switch back with a preload,
 * and point Node's compile cache at Squeal's own directory when the user set
 * none. Each script runs under dash and bash from a path with spaces, and
 * runs a probe that reports what it and a child it spawns with its execArgv see.
 */

const SHELLS = ["dash", "bash"].filter(
  (shell) => spawnSync("sh", ["-c", `command -v ${shell}`]).status === 0,
);
const HOOKS = ["plugins/claude-code/hooks/run", "plugins/antigravity/hooks/run"];
const CLIS = ["plugins/claude-code/bin/squeal", "plugins/opencode/bin/squeal"];
const LAUNCHER = "plugins/claude-code/bin/squeal-launcher";
const SCRIPTS = [...HOOKS, ...CLIS, LAUNCHER];
const RESTORE =
  "data:text/javascript,if(process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY!==undefined){process.env.NODE_USE_ENV_PROXY=process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY;Reflect.deleteProperty(process.env,'SQUEAL_CARRIED_NODE_USE_ENV_PROXY')}";

const PROBE = `import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getCompileCacheDir } from "node:module";
const proxyAtStart = process.moduleLoadList.includes("NativeModule _http_agent");
const pick = (e) => ({ proxy: e.NODE_USE_ENV_PROXY ?? null, carried: e.SQUEAL_CARRIED_NODE_USE_ENV_PROXY ?? null });
const child = JSON.parse(execFileSync(process.execPath, [...process.execArgv, "-p",
  "JSON.stringify({ proxy: process.env.NODE_USE_ENV_PROXY ?? null, carried: process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY ?? null })"],
  { encoding: "utf8" }));
let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch {}
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2), execArgv: process.execArgv, ...pick(process.env), proxyAtStart, child,
  cache: process.env.NODE_COMPILE_CACHE ?? null, own: process.env.SQUEAL_OWN_COMPILE_CACHE ?? null,
  cacheDir: getCompileCacheDir() ?? null, stdin,
}));
`;

interface Seen {
  argv: string[];
  execArgv: string[];
  proxy: string | null;
  carried: string | null;
  proxyAtStart: boolean;
  child: { proxy: string | null; carried: string | null };
  cache: string | null;
  own: string | null;
  cacheDir: string | null;
  stdin: string;
}

function write(path: string, text: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}

/** A machine under a path with spaces: the script, its probe, a home and a project using Squeal. */
function machine(script: string) {
  const root = join(tempDir("sq-startup-"), "with space");
  const home = join(root, "home dir");
  const project = join(root, "my project");
  write(join(project, "squeal.config.json"), "{}\n");
  // The launcher finds an OpenCode package under XDG_DATA_HOME, whatever HOME is.
  const plugin =
    script === LAUNCHER
      ? join(root, "data dir", "squeal", "opencode", "1.0.0")
      : join(root, "plugin dir");
  write(join(plugin, "dist", "cli", "squeal.mjs"), PROBE);
  write(join(plugin, "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  const copy =
    script === LAUNCHER
      ? join(root, "bin dir", "squeal")
      : join(plugin, script.split("/").slice(2).join("/"));
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(join(REPO_ROOT, script), copy);
  chmodSync(copy, 0o755);
  return { root, home, project, plugin, copy };
}

/** Runs `script` under `shell` with `env` over a bare environment, as a hook or as `squeal <command> "a b" c`. */
function run(
  script: string,
  shell: string,
  env: Record<string, string | undefined>,
  options: { command?: string; guard?: boolean } = {},
): Seen & { home: string; root: string } {
  const m = machine(script);
  const command = options.command ?? "status";
  const hook = HOOKS.includes(script);
  const probe = join(m.plugin, "dist", "cli", "squeal.mjs");
  const args = hook
    ? [
        ...(options.guard ? ["--if-squeal"] : []),
        "node",
        "--disable-warning=ExperimentalWarning",
        probe,
        "a b",
        "c",
      ]
    : [command, "a b", "c"];
  const full: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: m.home,
    XDG_DATA_HOME: join(m.root, "data dir"),
  };
  for (const [name, value] of Object.entries(env)) {
    const resolved = value?.replace("<root>", m.root);
    if (resolved === undefined) delete full[name];
    else full[name] = resolved;
  }
  if (hook && options.guard) full.CLAUDE_PROJECT_DIR = m.project;
  const payload = JSON.stringify({ cwd: m.project, hook: "x" });
  const result = spawnSync(shell, [m.copy, ...args], {
    env: full,
    cwd: m.root,
    input: payload,
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(result.stderr, `${shell} ${script}`).toBe("");
  expect(result.status, `${shell} ${script}`).toBe(0);
  return { ...(JSON.parse(result.stdout) as Seen), home: m.home, root: m.root };
}

const PROXY_URL = { HTTPS_PROXY: "http://proxy.invalid:3128" };
/** Whether this Node sets the proxy up at its start for NODE_USE_ENV_PROXY=1: the control. */
const NODE_SETS_UP_PROXY =
  spawnSync(
    process.execPath,
    ["-p", 'process.moduleLoadList.includes("NativeModule _http_agent")'],
    {
      env: { PATH: process.env.PATH ?? "", ...PROXY_URL, NODE_USE_ENV_PROXY: "1" },
      encoding: "utf8",
    },
  ).stdout.trim() === "true";

describe.each(SHELLS)("under %s (spec 025 D7)", (shell) => {
  describe.each(SCRIPTS)("%s", (script) => {
    it.each([{ value: "1" }, { value: "" }])(
      "starts Node without the proxy setup and hands NODE_USE_ENV_PROXY=$value back to the code and its children",
      ({ value }) => {
        const seen = run(script, shell, { ...PROXY_URL, NODE_USE_ENV_PROXY: value });
        expect(seen.argv).toEqual(HOOKS.includes(script) ? ["a b", "c"] : ["status", "a b", "c"]);
        expect(seen).toMatchObject({
          proxy: value,
          carried: null,
          proxyAtStart: false,
          child: { proxy: value, carried: null },
        });
        // The launcher takes the preload out of what the CLI spawns with; the others leave the guarded no-op.
        expect(seen.execArgv.includes("--import")).toBe(script !== LAUNCHER);
      },
    );

    it("adds no preload without NODE_USE_ENV_PROXY", () => {
      const seen = run(script, shell, { ...PROXY_URL });
      expect(seen).toMatchObject({
        proxy: null,
        carried: null,
        child: { proxy: null, carried: null },
      });
      expect(seen.execArgv).toEqual(["--disable-warning=ExperimentalWarning"]);
    });

    it("sets Squeal's own compile cache, 0700, when the user set none", () => {
      const seen = run(script, shell, {});
      const dir = join(seen.home, ".cache", "squeal", "compile-cache");
      expect(seen).toMatchObject({ cache: dir, own: "1" });
      expect(seen.cacheDir?.startsWith(`${dir}/`)).toBe(true);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    });

    it("keeps a compile cache the user set, empty included, and marks nothing", () => {
      for (const mine of ["<root>/mine", ""]) {
        const seen = run(script, shell, { NODE_COMPILE_CACHE: mine });
        expect(seen).toMatchObject({ cache: mine.replace("<root>", seen.root), own: null });
      }
    });

    it("uses XDG_CACHE_HOME, and sets no cache without an absolute writable home", () => {
      const xdg = run(script, shell, { XDG_CACHE_HOME: "<root>/xdg cache" });
      expect(xdg).toMatchObject({
        cache: join(xdg.root, "xdg cache", "squeal", "compile-cache"),
        own: "1",
      });
      expect(run(script, shell, { HOME: undefined })).toMatchObject({ cache: null, own: null });
      expect(run(script, shell, { HOME: "relative" })).toMatchObject({ cache: null, own: null });
    });
  });

  it.skipIf(process.getuid?.() === 0)("sets no cache where the directory cannot be made", () => {
    const m = machine(HOOKS[0] as string);
    write(join(m.root, "locked", "keep"), "");
    chmodSync(join(m.root, "locked"), 0o555);
    try {
      for (const script of SCRIPTS) {
        const seen = run(script, shell, { XDG_CACHE_HOME: join(m.root, "locked") });
        expect(seen, script).toMatchObject({ cache: null, own: null });
      }
    } finally {
      chmodSync(join(m.root, "locked"), 0o755);
    }
  });

  it.each(HOOKS)("%s carries the switch past --if-squeal too", (script) => {
    const seen = run(script, shell, { NODE_USE_ENV_PROXY: "1" }, { guard: true });
    expect(seen).toMatchObject({ argv: ["a b", "c"], proxy: "1", carried: null, own: "1" });
    // Antigravity hands the payload it read on to the hook.
    if (script.includes("antigravity")) expect(JSON.parse(seen.stdin)).toMatchObject({ hook: "x" });
  });

  it.each([...CLIS, LAUNCHER])(
    "%s keeps the proxy setup for update, codex-runtime, remote and an unknown command",
    (script) => {
      for (const command of ["update", "codex-runtime", "remote", "something"]) {
        const seen = run(script, shell, { ...PROXY_URL, NODE_USE_ENV_PROXY: "1" }, { command });
        expect(seen, command).toMatchObject({ proxy: "1", carried: null, own: "1" });
        expect(seen.execArgv, command).toEqual(["--disable-warning=ExperimentalWarning"]);
        expect(seen.proxyAtStart, command).toBe(NODE_SETS_UP_PROXY);
      }
    },
  );
});

describe("the restore preload (spec 025 D7)", () => {
  it.each(SCRIPTS)("%s carries the one guarded preload", (script) => {
    expect(readFileSync(join(REPO_ROOT, script), "utf8")).toContain(`--import "${RESTORE}"`);
  });

  it("writes nothing where nothing was carried, as in a child given the CLI's execArgv", () => {
    const { NODE_USE_ENV_PROXY: _a, SQUEAL_CARRIED_NODE_USE_ENV_PROXY: _b, ...env } = process.env;
    const out = spawnSync(
      process.execPath,
      ["--import", RESTORE, "-p", 'JSON.stringify("NODE_USE_ENV_PROXY" in process.env)'],
      { env, encoding: "utf8" },
    );
    expect(out.stdout.trim()).toBe("false");
  });
});
