import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/build.js";
import { tempDir } from "../store/helpers.js";
import { FixtureCli } from "./fixture-cli.js";
import { e2eSuite } from "./harness.js";
import { CODEX_SESSION, PLUGINS, type Plugin } from "./plugins.js";
import { cliProcess, cliWith, daemonProcesses, soon } from "./restart-evidence.js";

const fixture = e2eSuite();

const versionIn = (path: string) =>
  (JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8")) as { version: string }).version;
const RELEASE = versionIn("package.json");
const SEED = versionIn("plugins/codex/seed/runtime.json");

/** The runtimes a fixture of `plugin` runs: the release under test, and on request Codex's seed. */
const runtimes = (plugin: Plugin) => [
  { seed: false, version: RELEASE },
  ...(plugin.name === "codex" ? [{ seed: true, version: SEED }] : []),
];

describe.runIf(process.platform === "linux").each(PLUGINS)("fixture CLI, $name", (plugin) => {
  it("keeps the fixture environment and adds command-specific values", async (ctx) => {
    const e = fixture(ctx, plugin, { tmpfs: true });
    // A command stand-in reports only these named values, never the process environment.
    writeFileSync(
      e.cliIdentity.path,
      `console.log(JSON.stringify({
        args: process.argv.slice(2),
        home: process.env.HOME,
        codex: process.env.CODEX_HOME,
        data: process.env.PLUGIN_DATA,
        runtime: process.env.XDG_RUNTIME_DIR,
        extra: process.env.SQUEAL_FIXTURE_EXTRA,
      }));`,
    );
    const result = await cliWith(e, ["fixture-command", "argument"], {
      HOME: join(e.base, "command-home"),
      SQUEAL_FIXTURE_EXTRA: "present",
    });
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["fixture-command", "argument"],
      home: join(e.base, "command-home"),
      ...(plugin.name === "codex"
        ? { codex: `${e.plugin}.home/.codex`, data: `${e.plugin}.data` }
        : {}),
      runtime: e.runtime,
      extra: "present",
    });
  });

  for (const { seed, version } of runtimes(plugin)) {
    it(`runs ${version}${seed ? ", the frozen seed," : ""} through its hooks, finds the actual daemon and leaves none after cleanup`, async (ctx) => {
      const e = fixture(ctx, plugin, { tmpfs: true, codexSeed: seed });
      await e.hook("session-start", e.main);
      const daemon = await e.daemonReady(e.main);
      // Row 019-31: the hooks run the release under test, unless a test asks for the seed.
      expect(daemon.squealVersion).toBe(version);
      const data = `${e.plugin}.data`;
      if (plugin.name === "codex") {
        // The `squeal` the Codex hooks' texts name, as the agent runs it in this session.
        const launcher = spawnSync(join(data, "bin/squeal"), ["--version"], {
          encoding: "utf8",
          env: {
            PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
            HOME: `${e.plugin}.home`,
            CODEX_HOME: `${e.plugin}.home/.codex`,
            CODEX_SESSION_ID: CODEX_SESSION,
            XDG_RUNTIME_DIR: e.runtime,
          },
        });
        expect(launcher.stdout, launcher.stderr).toBe(`${version}\n`);
      }
      const argv = readFileSync(`/proc/${daemon.pid}/cmdline`, "utf8").split("\0");
      const expected =
        plugin.name === "codex"
          ? join(data, "versions", version, "dist/cli/squeal.mjs")
          : join(e.plugin, "dist/cli/squeal.mjs");
      expect(argv).toContain(expected);

      const status = await cliWith(e, ["status", "--json"], {});
      expect(status).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(status.stdout)).toMatchObject({ available: true });
      expect(cliProcess(e, "daemon")).toBe(daemon.pid);
      expect(await daemonProcesses(e)).toContain(expected);

      await e.cleanup();
      expect(
        await soon(10_000, () => (existsSync(`/proc/${daemon.pid}`) ? null : true)),
        "the daemon exited before teardown finished",
      ).toBe(true);
      expect(cliProcess(e, "daemon")).toBeNull();
      expect(await daemonProcesses(e)).toContain("no daemon process");
    }, 120_000);
  }
});

describe("fixture CLI identity", () => {
  it("uses the Codex seed before bootstrap and the selected retained CLI afterward", () => {
    const plugin = join(tempDir("squeal-fixture-cli-"), "plugin with.space");
    const data = `${plugin}.data`;
    const cli = new FixtureCli(plugin, data);
    expect(cli.path).toBe(join(plugin, "seed/dist/cli/squeal.mjs"));
    mkdirSync(join(data, "runtime"), { recursive: true });
    writeFileSync(join(data, "runtime/current.json"), '{"schema":1,"version":"8.0.1"}');
    expect(cli.path).toBe(join(data, "versions/8.0.1/dist/cli/squeal.mjs"));
  });

  it.each([" ", "\0"] as const)(
    "matches seed and older retained commands with %j after files are removed",
    (separator) => {
      const base = tempDir("squeal-fixture-cli-");
      const plugin = join(base, "plugin with.space");
      const data = `${plugin}.data`;
      const cli = new FixtureCli(plugin, data);
      const command = (path: string, verb = "daemon") =>
        ["squeal repo daemon @id", path, verb, "/repo"].join(separator);
      mkdirSync(join(data, "runtime"), { recursive: true });
      writeFileSync(join(data, "runtime/current.json"), '{"schema":1,"version":"8.0.1"}');
      rmSync(base, { recursive: true });

      for (const path of [
        join(plugin, "seed/dist/cli/squeal.mjs"),
        join(data, "versions/7.0.0/dist/cli/squeal.mjs"),
      ]) {
        expect(cli.matches(command(path), "daemon", separator)).toBe(true);
        expect(cli.matches(command(path, "stop"), "stop", separator)).toBe(true);
        expect(cli.matches(command(path, "daemon-other"), "daemon", separator)).toBe(false);
        expect(cli.matches(command(path, "stop"), "daemon", separator)).toBe(false);
      }
      for (const path of [
        join(plugin, "dist/cli/squeal.mjs"),
        join(`${data}-other`, "versions/7.0.0/dist/cli/squeal.mjs"),
        join(data, "versions/7x0x0/dist/cli/squeal.mjs"),
      ]) {
        expect(cli.matches(command(path), "daemon", separator)).toBe(false);
      }
      const legacy = new FixtureCli(plugin);
      expect(legacy.matches(command(legacy.path), "daemon", separator)).toBe(true);
      expect(legacy.matches(command(legacy.path, "stop"), "daemon", separator)).toBe(false);
      expect(
        legacy.matches(command(join(plugin, "seed/dist/cli/squeal.mjs")), "daemon", separator),
      ).toBe(false);
    },
  );
});
