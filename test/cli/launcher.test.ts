import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { LAUNCHER, type Machine, machine, writePlugin } from "./install-fixture.js";

/* Spec 005 D3, the launcher: which installed plugin `squeal` on the terminal's PATH runs. */

interface Entry {
  readonly scope: "user" | "project";
  readonly version: string;
  readonly projectPath?: string;
}

/** Claude Code's `installed_plugins.json` holding `entries` in this order, each with its plugin. */
function claudeInstalls(m: Machine, entries: readonly Entry[]): void {
  const plugins = join(m.claudeConfig, "plugins");
  const list = entries.map((e) => {
    const installPath = join(plugins, "cache", "hearsay", "squeal", e.version);
    writePlugin(installPath, "claude-code", e.version);
    return { ...e, installPath };
  });
  mkdirSync(plugins, { recursive: true });
  writeFileSync(
    join(plugins, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "squeal@hearsay": list, "other@x": [] } }),
  );
}

function codexInstalls(m: Machine, versions: readonly string[]): void {
  for (const v of versions)
    writePlugin(join(m.codexHome, "plugins", "cache", "hearsay", "squeal", v), "codex", v);
}

/** Pi packages as install.sh unpacks them (spec 009 D1), under `XDG_DATA_HOME` when it is set. */
function piInstalls(m: Machine, versions: readonly string[]): void {
  const data = m.env.XDG_DATA_HOME ?? join(m.home, ".local", "share");
  for (const v of versions) writePlugin(join(data, "squeal", "pi", v), "pi", v);
}

/** OpenCode packages as install.sh unpacks them (spec 008 D1), with `current` at `linked`. */
function openCodeInstalls(m: Machine, versions: readonly string[], linked?: string): void {
  const home = join(m.env.XDG_DATA_HOME ?? join(m.home, ".local", "share"), "squeal", "opencode");
  for (const v of versions) writePlugin(join(home, v), "opencode", v);
  if (linked !== undefined) symlinkSync(linked, join(home, "current"));
}

/** Runs the launcher in `cwd` and reads the fake CLI's report. */
function launch(m: Machine, args: readonly string[] = [], cwd = m.home) {
  const r = m.sh([LAUNCHER, ...args], { cwd });
  const ran =
    r.stdout === ""
      ? null
      : (JSON.parse(r.stdout) as { version: string; harness: string; args: string[] });
  return { ...r, ran };
}

function project(m: Machine, name: string): string {
  const dir = join(m.root, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  return dir;
}

describe("the launcher", () => {
  it("runs the user-scope plugin's CLI with the arguments, and passes its exit code", () => {
    const m = machine();
    claudeInstalls(m, [{ scope: "user", version: "0.1.131" }]);
    const r = launch(m, ["status", "--exit", "7"]);
    expect(r.ran).toEqual({
      version: "0.1.131",
      harness: "claude-code",
      args: ["status", "--exit", "7"],
    });
    expect(r.status).toBe(7);
    expect(r.stderr).toBe("");
  });

  it("takes the first applicable entry: user first, then project for this directory", () => {
    const m = machine();
    const proj = project(m, "proj");
    claudeInstalls(m, [
      { scope: "user", version: "0.1.131" },
      { scope: "project", version: "0.1.132", projectPath: proj },
    ]);
    expect(launch(m, [], proj).ran?.version).toBe("0.1.131");
    expect(launch(m, [], join(proj, "src")).ran?.version).toBe("0.1.131");
  });

  it("takes the first applicable entry: project for this directory first, then user", () => {
    const m = machine();
    const proj = project(m, "proj");
    claudeInstalls(m, [
      { scope: "project", version: "0.1.132", projectPath: proj },
      { scope: "user", version: "0.1.131" },
    ]);
    expect(launch(m, [], proj).ran?.version).toBe("0.1.132");
    expect(launch(m, [], join(proj, "src")).ran?.version).toBe("0.1.132");
    // Another directory, or one whose name only starts like the project's, gets the user entry.
    expect(launch(m, [], project(m, "other")).ran?.version).toBe("0.1.131");
    expect(launch(m, [], project(m, "proj2")).ran?.version).toBe("0.1.131");
  });

  it("skips a project entry for another directory, and an entry whose plugin is gone", () => {
    const m = machine();
    claudeInstalls(m, [
      { scope: "project", version: "0.1.133", projectPath: project(m, "other") },
      { scope: "user", version: "0.1.130" },
      { scope: "user", version: "0.1.131" },
    ]);
    rmSync(join(m.claudeConfig, "plugins", "cache", "hearsay", "squeal", "0.1.130"), {
      recursive: true,
    });
    expect(launch(m).ran?.version).toBe("0.1.131");
  });

  it("runs the newest Codex cache version when only Codex has the plugin", () => {
    const m = machine();
    codexInstalls(m, ["0.1.99", "0.1.131", "0.1.100"]);
    const r = launch(m, ["--version"]);
    expect(r.ran).toEqual({ version: "0.1.131", harness: "codex", args: ["--version"] });
    expect(r.stderr).toBe("");
  });

  it("runs the newer when the harnesses differ, and names both and squeal update in one line", () => {
    for (const [claude, codex] of [
      ["0.1.132", "0.1.131"],
      ["0.1.99", "0.1.131"],
    ] as const) {
      const m = machine();
      claudeInstalls(m, [{ scope: "user", version: claude }]);
      codexInstalls(m, [codex]);
      const r = launch(m);
      const newer = claude === "0.1.132" ? claude : codex;
      expect(r.ran?.version).toBe(newer);
      expect(r.stderr).toBe(
        `squeal: Claude Code has squeal ${claude} and Codex has ${codex}; running ${newer}. Run squeal update to bring them to one version.\n`,
      );
    }
  });

  it("runs the newest Pi package when only Pi has Squeal, under XDG_DATA_HOME when set", () => {
    const m = machine();
    piInstalls(m, ["0.1.170", "0.1.99"]);
    // A directory without a CLI, as a cut unpack leaves it, is not a package.
    mkdirSync(join(m.home, ".local", "share", "squeal", "pi", "0.1.171"), { recursive: true });
    const r = launch(m, ["status"]);
    expect(r.ran).toEqual({ version: "0.1.170", harness: "pi", args: ["status"] });
    expect(r.stderr).toBe("");
    m.env.XDG_DATA_HOME = join(m.root, "data");
    piInstalls(m, ["0.1.172"]);
    expect(launch(m).ran?.version).toBe("0.1.172");
  });

  it("names every harness and squeal update when Pi's version differs", () => {
    const m = machine();
    claudeInstalls(m, [{ scope: "user", version: "0.1.170" }]);
    codexInstalls(m, ["0.1.170"]);
    piInstalls(m, ["0.1.171"]);
    const r = launch(m);
    expect(r.ran?.harness).toBe("pi");
    expect(r.stderr).toBe(
      "squeal: Claude Code has squeal 0.1.170, Codex has 0.1.170 and Pi has 0.1.171; running 0.1.171. Run squeal update to bring them to one version.\n",
    );
  });

  it("runs the newest OpenCode package when only OpenCode has Squeal, whatever current names", () => {
    const m = machine();
    // current still at the older one, as between an unpack and its repoint.
    openCodeInstalls(m, ["0.1.176", "0.1.99", "0.1.177"], "0.1.176");
    // A directory without a CLI, as a cut unpack leaves it, is not a package.
    mkdirSync(join(m.home, ".local", "share", "squeal", "opencode", "0.1.178"), {
      recursive: true,
    });
    const r = launch(m, ["status"]);
    expect(r.ran).toEqual({ version: "0.1.177", harness: "opencode", args: ["status"] });
    expect(r.stderr).toBe("");
    m.env.XDG_DATA_HOME = join(m.root, "data");
    openCodeInstalls(m, ["0.1.179"]);
    expect(launch(m).ran?.version).toBe("0.1.179");
  });

  it("names OpenCode with the others when its version differs", () => {
    const m = machine();
    claudeInstalls(m, [{ scope: "user", version: "0.1.176" }]);
    piInstalls(m, ["0.1.176"]);
    openCodeInstalls(m, ["0.1.177"], "0.1.177");
    const r = launch(m);
    expect(r.ran?.harness).toBe("opencode");
    expect(r.stderr).toBe(
      "squeal: Claude Code has squeal 0.1.176, Pi has 0.1.176 and OpenCode has 0.1.177; running 0.1.177. Run squeal update to bring them to one version.\n",
    );
  });

  it("says nothing when both harnesses hold one version", () => {
    const m = machine();
    claudeInstalls(m, [{ scope: "user", version: "0.1.134" }]);
    codexInstalls(m, ["0.1.134"]);
    const r = launch(m);
    expect(r.ran?.version).toBe("0.1.134");
    expect(r.stderr).toBe("");
  });

  it("prints the install commands and exits 1 when no plugin is installed", () => {
    const m = machine();
    mkdirSync(join(m.claudeConfig, "plugins"), { recursive: true });
    writeFileSync(join(m.claudeConfig, "plugins", "installed_plugins.json"), "{ not json");
    const r = launch(m, ["status"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(
      "no squeal@hearsay plugin is installed in Claude Code or Codex, and no Squeal package in Pi or OpenCode",
    );
    expect(r.stderr).toContain("claude plugin install squeal@hearsay");
    expect(r.stderr).toContain("codex plugin add squeal@hearsay");
    expect(r.stderr).toContain("install.sh");
  });

  it.each([["codex"], ["pi"], ["opencode"]])(
    "is the same executable file in the %s plugin, and carries its format line",
    (plugin) => {
      const copy = join(REPO_ROOT, "plugins", plugin, "bin", "squeal-launcher");
      expect(readFileSync(copy, "utf8")).toBe(readFileSync(LAUNCHER, "utf8"));
      expect(readFileSync(copy, "utf8")).toMatch(/^#!\/bin\/sh\n# squeal-launcher format \d+\n/);
      expect(statSync(copy).mode & 0o111).toBe(0o111);
    },
  );
});

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73): as <PLUGIN_DATA>/bin/squeal,
 * the launcher also runs Squeal's copies beside it, which a Codex install of
 * another version does not delete.
 */
describe("the launcher in the plugin data directory", () => {
  /** The data directory as Codex's SessionStart leaves it: the launcher and a copy of each version. */
  function kept(m: Machine, versions: readonly string[]): string {
    const data = join(m.codexHome, "plugins", "data", "squeal-hearsay");
    for (const v of versions) {
      const cli = join(data, "versions", v, "dist", "cli", "squeal.mjs");
      mkdirSync(join(cli, ".."), { recursive: true });
      writeFileSync(
        cli,
        `console.log(JSON.stringify({ version: "${v}", harness: "copy", args: process.argv.slice(2) }));\n`,
      );
    }
    mkdirSync(join(data, "bin"), { recursive: true });
    writeFileSync(join(data, "bin", "squeal"), readFileSync(LAUNCHER, "utf8"));
    chmodSync(join(data, "bin", "squeal"), 0o755);
    return join(data, "bin", "squeal");
  }
  const run = (m: Machine, launcher: string) => {
    const r = m.sh([launcher, "status"]);
    return { ...r, ran: JSON.parse(r.stdout) as { version: string; harness: string } };
  };

  it("runs the copy over the cache's plugin of the same version, and says nothing", () => {
    const m = machine();
    codexInstalls(m, ["0.1.250"]);
    const r = run(m, kept(m, ["0.1.249", "0.1.250"]));
    expect(r.ran).toMatchObject({ version: "0.1.250", harness: "copy" });
    expect(r.stderr).toBe("");
  });

  it("runs a newer installed plugin, and names the session's older copy", () => {
    const m = machine();
    codexInstalls(m, ["0.1.250"]);
    const r = run(m, kept(m, ["0.1.249"]));
    expect(r.ran).toMatchObject({ version: "0.1.250", harness: "codex" });
    expect(r.stderr).toBe(
      "squeal: running squeal 0.1.250; Codex sessions started on 0.1.249 run 0.1.249 until they restart.\n",
    );
  });

  it("runs the newest copy when no plugin is installed, as while Codex replaces its cache", () => {
    const m = machine();
    const r = run(m, kept(m, ["0.1.249", "0.1.250"]));
    expect(r.ran).toMatchObject({ version: "0.1.250", harness: "copy" });
    expect(r.stderr).toBe("");
  });

  it("sees no copies as the plugin's own launcher, with versions/ beside its plugin root", () => {
    const m = machine();
    codexInstalls(m, ["0.1.250"]);
    const root = join(m.codexHome, "plugins", "cache", "hearsay", "squeal", "0.1.250");
    mkdirSync(join(root, "versions", "0.1.251", "dist", "cli"), { recursive: true });
    const r = m.sh([join(root, "bin", "squeal-launcher"), "status"]);
    expect(JSON.parse(r.stdout)).toMatchObject({ version: "0.1.250", harness: "codex" });
  });
});
