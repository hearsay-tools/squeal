import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIST } from "../../src/harness/claude-code/build.js";
import { LAUNCHER, type Machine, machine, writePlugin } from "./install-fixture.js";

/*
 * Row 005-75: the launcher finds the CLI and runs it in one Node. A second
 * Node start for the lookup cost each command about 0.06 s of CPU
 * (docs/specifications/005-agent-adoption/tasks/005-75/notes.md). The CLI
 * must still see the process as `node --disable-warning=ExperimentalWarning
 * <cli> <args>` gives it, since `squeal start` spawns its daemon from
 * `process.argv[1]` and test/keys/launchers.test.ts skips the lookup's `-e`.
 */

/** A Codex cache install of `version`; returns its plugin directory. */
function codexPlugin(m: Machine, version: string): string {
  const dir = join(m.codexHome, "plugins", "cache", "hearsay", "squeal", version);
  writePlugin(dir, "codex", version);
  return dir;
}

/**
 * A Claude Code user-scope install of `version`, as `installed_plugins.json`
 * names it; returns its plugin directory.
 */
function claudePlugin(m: Machine, version: string): string {
  const dir = join(m.claudeConfig, "plugins", "cache", "hearsay", "squeal", version);
  writePlugin(dir, "claude-code", version);
  const entry = { scope: "user", installPath: dir, version };
  writeFileSync(
    join(m.claudeConfig, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "squeal@hearsay": [entry] } }),
  );
  return dir;
}

/** Puts a `node` on the machine's PATH that logs each start; returns the count so far. */
function countNodeStarts(m: Machine): () => number {
  const node = join(m.root, "node-bin", "node");
  const log = join(m.root, "node-starts.log");
  rmSync(node);
  writeFileSync(log, "");
  writeFileSync(node, `#!/bin/sh\necho start >> '${log}'\nexec '${process.execPath}' "$@"\n`);
  chmodSync(node, 0o755);
  return () => readFileSync(log, "utf8").split("\n").length - 1;
}

/** The pids and arguments `ps` shows for every process whose arguments name `text`. */
function processesNaming(text: string): { pid: number; args: string }[] {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" });
  return ps.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && match[2]?.includes(text) === true)
    .map((match) => ({ pid: Number(match?.[1]), args: match?.[2] ?? "" }));
}

describe("the launcher's one Node", () => {
  it("starts Node once, and the CLI sees the process as `node <cli>` would give it", () => {
    const m = machine();
    const cli = join(codexPlugin(m, "0.1.250"), "dist", "cli", "squeal.mjs");
    writeFileSync(
      cli,
      "console.log(JSON.stringify({ argv: process.argv.slice(1), execArgv: process.execArgv }));\n",
    );
    const starts = countNodeStarts(m);
    const r = m.sh([LAUNCHER, "status", "--wait", "60000"]);
    expect(r.stdout).toBe(
      `${JSON.stringify({
        argv: [cli, "status", "--wait", "60000"],
        execArgv: ["--disable-warning=ExperimentalWarning"],
      })}\n`,
    );
    expect(starts()).toBe(1);
  });

  it("spawns `squeal start`'s daemon from the CLI's path, with no Node flag", {
    timeout: 60_000,
  }, () => {
    const m = machine();
    // The committed Claude Code bundle as Claude Code's installed CLI: one in Codex's cache
    // spawns its daemon from the kept copy of its version instead (row 005-77).
    const plugin = claudePlugin(m, "0.1.250");
    rmSync(join(plugin, "dist"), { recursive: true });
    symlinkSync(PLUGIN_DIST, join(plugin, "dist"));
    const cli = join(plugin, "dist", "cli", "squeal.mjs");
    m.env.XDG_RUNTIME_DIR = join(m.root, "run");
    m.env.XDG_CONFIG_HOME = join(m.root, "config");
    mkdirSync(m.env.XDG_RUNTIME_DIR, { mode: 0o700 });
    const repo = join(m.root, "repo");
    mkdirSync(repo);
    const git = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
    git("init", "-q");
    writeFileSync(join(repo, "package.json"), '{ "name": "scratch", "private": true }\n');
    git("add", "-A");
    git("commit", "-qm", "scratch");
    const root = realpathSync(repo);
    try {
      const r = m.sh([LAUNCHER, "start"], { cwd: repo });
      expect(r.stdout, r.stderr).toContain(`Squeal daemon spawned for ${root}\n`);
      const daemons = processesNaming(`${cli} daemon ${root}`);
      expect(daemons).toHaveLength(1);
      // Node, then the CLI: no `-e`, and no other flag before the script.
      expect(daemons[0]?.args).toMatch(/^\S+ \S+\/dist\/cli\/squeal\.mjs daemon /);
    } finally {
      const r = m.sh([LAUNCHER, "stop"], { cwd: repo });
      for (const { pid } of processesNaming(` daemon ${root}`)) process.kill(pid, "SIGKILL");
      expect(r.status, r.stderr).toBe(0);
    }
  });
});
