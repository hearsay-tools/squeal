import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishRuntime, selectRuntime } from "../../src/harness/codex/adapter/store.js";
import {
  codexDataOf,
  writeCurrent,
  writeFixedPlugin,
  writePin,
  writeRuntime,
} from "./codex-runtime-fixture.js";
import { LAUNCHER, type Machine, machine, writePlugin } from "./install-fixture.js";

/*
 * Spec 002 D7 to D9, the launcher with the fixed Codex plugin: the runtime a
 * Codex session is pinned to, else the current one or the seed; never the
 * adapter version, and never another runtime for a pinned session.
 */

const TEXT = readFileSync(LAUNCHER, "utf8");
const ADAPTER = "1.0.0";

interface Ran {
  readonly version: string;
  readonly harness: string;
  readonly args: string[];
  readonly cli?: string;
}

const cacheOf = (m: Machine) => join(m.codexHome, "plugins", "cache", "hearsay", "squeal");
const dataOf = (m: Machine) => codexDataOf(m.codexHome);

/** The fixed plugin in Codex's cache with a seed of `seed`; returns its root. */
function fixed(m: Machine, seed: string): string {
  const root = join(cacheOf(m), ADAPTER);
  writeFixedPlugin(root, ADAPTER, seed, TEXT);
  return root;
}

/** Retained runtimes in the data directory, `current` naming the last one unless given. */
function retained(m: Machine, versions: readonly string[], current = versions.at(-1)): void {
  for (const v of versions) writeRuntime(join(dataOf(m), "versions", v), v, TEXT);
  if (current !== undefined) writeCurrent(dataOf(m), current);
}

function launch(m: Machine, env: Record<string, string> = {}, launcher = LAUNCHER) {
  const r = spawn(m, launcher, env);
  return { ...r, ran: r.stdout === "" ? null : (JSON.parse(r.stdout) as Ran) };
}

function spawn(m: Machine, launcher: string, env: Record<string, string>) {
  Object.assign(m.env, env);
  try {
    return m.sh([launcher, "status"]);
  } finally {
    for (const name of Object.keys(env)) delete m.env[name];
  }
}

const cliIn = (dir: string) => join(dir, "dist", "cli", "squeal.mjs");

describe("the launcher with the fixed Codex plugin", () => {
  it("runs the current runtime with the arguments, never the adapter version", () => {
    const m = machine();
    fixed(m, "0.1.360");
    retained(m, ["0.1.369", "0.1.370"]);
    const r = launch(m);
    expect(r.ran).toEqual({
      version: "0.1.370",
      harness: "codex-runtime",
      args: ["status"],
      cli: cliIn(join(dataOf(m), "versions", "0.1.370")),
    });
    expect(r.stderr).toBe("");
  });

  it("runs the seed before any runtime is current, and when the seed is newer", () => {
    const m = machine();
    const root = fixed(m, "0.1.360");
    expect(launch(m).ran?.cli).toBe(cliIn(join(root, "seed")));
    retained(m, ["0.1.359"]);
    expect(launch(m).ran).toMatchObject({ version: "0.1.360", cli: cliIn(join(root, "seed")) });
    // A current record whose runtime is not whole is no runtime.
    retained(m, ["0.1.361"]);
    rmSync(cliIn(join(dataOf(m), "versions", "0.1.361")));
    expect(launch(m).ran?.version).toBe("0.1.360");
  });

  it("compares Claude Code's plugin with the Codex runtime, and names both runtimes when they differ", () => {
    const m = machine();
    fixed(m, "0.1.360");
    retained(m, ["0.1.370"]);
    const entry = (v: string) => {
      const installPath = join(m.claudeConfig, "plugins", "cache", "hearsay", "squeal", v);
      writePlugin(installPath, "claude-code", v);
      writeFileSync(
        join(m.claudeConfig, "plugins", "installed_plugins.json"),
        JSON.stringify({
          plugins: { "squeal@hearsay": [{ scope: "user", installPath, version: v }] },
        }),
      );
    };
    entry("0.1.370");
    expect(launch(m).stderr).toBe("");
    entry("0.1.371");
    const r = launch(m);
    expect(r.ran).toMatchObject({ version: "0.1.371", harness: "claude-code" });
    expect(r.stderr).toBe(
      "squeal: this command runs squeal 0.1.371; plugins: Claude Code 0.1.371 and Codex 0.1.370. Run squeal update to bring the plugins to one version.\n",
    );
  });

  it("keeps a pinned session, and its subagents, on its runtime after a newer one is current", () => {
    const m = machine();
    fixed(m, "0.1.360");
    retained(m, ["0.1.370", "0.1.371"]);
    writePin(dataOf(m), "s1", "0.1.370");
    const r = launch(m, { CODEX_SESSION_ID: "s1", CODEX_THREAD_ID: "s1" });
    expect(r.ran?.cli).toBe(cliIn(join(dataOf(m), "versions", "0.1.370")));
    expect(r.stderr).toBe(
      "squeal: this command runs squeal 0.1.370; plugins: Codex 0.1.371; this Codex session started on 0.1.370 and keeps it until it restarts.\n",
    );
    // A subagent's shell: its parent's session id, its own thread id.
    expect(launch(m, { CODEX_SESSION_ID: "s1", CODEX_THREAD_ID: "a1" }).ran?.version).toBe(
      "0.1.370",
    );
    expect(launch(m, { CODEX_THREAD_ID: "s1" }).ran?.version).toBe("0.1.370");
    // Another session, or none, runs the current runtime.
    expect(launch(m, { CODEX_SESSION_ID: "s2" }).ran?.version).toBe("0.1.371");
    expect(launch(m).ran?.version).toBe("0.1.371");
  });

  it("fails with an action, and runs no other version, when the pinned runtime is missing", () => {
    const m = machine();
    fixed(m, "0.1.360");
    retained(m, ["0.1.369", "0.1.370"]);
    writePin(dataOf(m), "s1", "0.1.369");
    rmSync(join(dataOf(m), "versions", "0.1.369"), { recursive: true });
    const r = launch(m, { CODEX_SESSION_ID: "s1" });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(
      `squeal: Squeal runtime 0.1.369, which this Codex session started with, is missing or incomplete at ${join(dataOf(m), "versions", "0.1.369")}. Squeal does not switch a running session to another runtime. Start a new Codex session to use the installed runtime.\n`,
    );
  });

  it("fails on an unreadable pin, a pin of another session and a version that is no release", () => {
    const m = machine();
    fixed(m, "0.1.360");
    retained(m, ["0.1.370"]);
    const file = writePin(dataOf(m), "s1", "0.1.370");
    for (const text of [
      "{ not json",
      '{"schema":1,"sessionId":"s2","version":"0.1.370"}',
      '{"schema":1,"sessionId":"s1","version":"../0.1.370"}',
    ]) {
      writeFileSync(file, text);
      const r = launch(m, { CODEX_SESSION_ID: "s1" });
      expect(r.status, text).toBe(1);
      expect(r.stderr, text).toBe(
        `squeal: the runtime record of this Codex session, ${file}, is unreadable. Squeal does not guess the runtime of a running session. Start a new Codex session.\n`,
      );
    }
  });

  it("names the plugin and the fix when neither a current runtime nor the seed is whole", () => {
    const m = machine();
    const root = fixed(m, "0.1.360");
    rmSync(cliIn(join(root, "seed")));
    const r = launch(m);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(
      `squeal: the squeal@hearsay plugin for Codex at ${root} has no usable runtime: none in ${dataOf(m)} is current and whole, and its seed is incomplete. Run install.sh again, or reinstall the plugin: codex plugin remove squeal@hearsay && codex plugin add squeal@hearsay\n`,
    );
  });

  it("reads the state the adapter's store writes: a published current runtime and a session's pin", () => {
    const m = machine();
    const root = fixed(m, "0.1.360");
    const pinned = selectRuntime({ pluginRoot: root, data: dataOf(m), sessionId: "s1" });
    expect(pinned).toMatchObject({ version: "0.1.360", source: "seed" });
    const release = join(m.root, "release");
    writeRuntime(release, "0.1.370", TEXT);
    publishRuntime({ sourceRoot: release, data: dataOf(m), select: true });
    expect(launch(m).ran?.cli).toBe(cliIn(join(dataOf(m), "versions", "0.1.370")));
    expect(launch(m, { CODEX_SESSION_ID: "s1" }).ran?.cli).toBe(cliIn(pinned.root));
  });

  it("as the data directory's launcher, lets pins and current decide, not the newest retained copy", () => {
    const m = machine();
    fixed(m, "0.1.360");
    retained(m, ["0.1.369", "0.1.370", "0.1.371"], "0.1.370");
    writePin(dataOf(m), "s1", "0.1.369");
    const launcher = join(dataOf(m), "bin", "squeal");
    mkdirSync(join(dataOf(m), "bin"), { recursive: true });
    writeFileSync(launcher, TEXT);
    chmodSync(launcher, 0o755);
    expect(launch(m, {}, launcher).ran?.version).toBe("0.1.370");
    expect(launch(m, { CODEX_SESSION_ID: "s1" }, launcher).ran?.version).toBe("0.1.369");
    // Its notice mark stays in the data directory.
    expect(launch(m, { CODEX_SESSION_ID: "s1" }, launcher).stderr).toBe("");
    expect(readFileSync(join(dataOf(m), "launcher-notices.json"), "utf8")).toContain("s1");
  });

  it("finds the runtime under a Codex home whose path has spaces, beside a legacy cache version", () => {
    const m = machine();
    m.env.CODEX_HOME = join(m.root, "my codex home");
    const home = { ...m, codexHome: m.env.CODEX_HOME };
    writePlugin(join(cacheOf(home), "0.1.367"), "codex", "0.1.367");
    fixed(home, "0.1.360");
    expect(launch(m).ran).toMatchObject({ version: "0.1.367", harness: "codex" });
    retained(home, ["0.1.370"]);
    const r = launch(m);
    expect(r.ran?.cli).toBe(cliIn(join(dataOf(home), "versions", "0.1.370")));
    expect(r.stderr).toBe("");
  });

  it("carries a format past 7, so squeal update replaces the launchers copied before runtimes", () => {
    expect(Number(/^# squeal-launcher format (\d+)$/m.exec(TEXT)?.[1])).toBeGreaterThan(7);
  });
});
