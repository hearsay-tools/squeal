import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnsureDaemonOptions } from "../../../src/core/daemon/ensure.js";
import { shellWord } from "../../../src/core/text.js";
import { runAntigravityHook } from "../../../src/harness/antigravity/hooks.js";
import { keepOnSpawn, registeredSkillLine } from "../../../src/harness/antigravity/kept.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { primer } from "../../../src/harness/shared/primer.js";
import { tempDir } from "../../store/helpers.js";
import { runtimeDir } from "../bundle-helpers.js";
import { squealRepo } from "../helpers.js";
import { antigravityRecorded, injected } from "./helpers.js";

/*
 * Spec 024 D1: an Antigravity hook keeps its version's copy of `PLUGIN_ROOT`
 * (`plugin.json` at the root) in `PLUGIN_DATA`, writes the launcher there,
 * prunes older copies, and names the copy's skill and the launcher.
 */

const V = "0.1.900";
type Options = EnsureDaemonOptions & { readonly socketTimeoutMs: number };
const LAUNCHER = "#!/bin/sh\n# squeal-launcher format 9\n";

/** A copy of `version` under `data`, made `ageMs` ago. */
function oldCopy(data: string, version: string, ageMs: number): string {
  const dir = join(data, "versions", version);
  mkdirSync(join(dir, "dist", "cli"), { recursive: true });
  writeFileSync(join(dir, "dist", "cli", "squeal.mjs"), "// old\n");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ version }));
  const at = (Date.now() - ageMs) / 1000;
  utimesSync(dir, at, at);
  return dir;
}

/** An installed plugin in Antigravity's layout, its data directory and the hook's deps. */
function plugin(manifestVersion = V) {
  const root = tempDir("squeal-agy-root-");
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  writeFileSync(join(root, "dist", "cli", "squeal.mjs"), "// the installed CLI\n");
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name: "squeal", version: manifestVersion }),
  );
  mkdirSync(join(root, "skills", "squeal"), { recursive: true });
  writeFileSync(join(root, "skills", "squeal", "SKILL.md"), "# Squeal\n");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "squeal-launcher"), LAUNCHER);
  const data = join(tempDir("squeal-agy-data-"), "squeal");
  const spawned: Options[] = [];
  const deps: HookDeps = {
    env: { PLUGIN_ROOT: root, PLUGIN_DATA: data },
    cli: join(root, "dist", "cli", "squeal.mjs"),
    command: `node --disable-warning=ExperimentalWarning ${shellWord(join(root, "dist/cli/squeal.mjs"))}`,
    squealVersion: V,
    ensureDaemon: (_root, options) => {
      spawned.push(options);
      return Promise.resolve("spawned");
    },
  };
  const copy = join(data, "versions", V);
  return { root, data, deps, spawned, copy, skill: join(copy, "skills", "squeal", "SKILL.md") };
}

const line = (skill: string) =>
  `Squeal's skill for this session, kept across plugin updates: \`${skill}\`.`;

describe("SessionStart keeps this version's copy (D1)", () => {
  it("copies dist, skills and plugin.json, writes the launcher, and names both", async () => {
    const p = plugin();
    const r = squealRepo();
    r.apply(r.pass());
    const out = await runAntigravityHook(
      "session-start",
      antigravityRecorded("session-start", r.root),
      p.deps,
    );
    expect(readFileSync(join(p.copy, "dist", "cli", "squeal.mjs"), "utf8")).toBe(
      "// the installed CLI\n",
    );
    expect(JSON.parse(readFileSync(join(p.copy, "plugin.json"), "utf8")).version).toBe(V);
    expect(readFileSync(p.skill, "utf8")).toBe("# Squeal\n");
    expect(existsSync(join(p.copy, ".codex-plugin"))).toBe(false);
    const launcher = join(p.data, "bin", "squeal");
    expect(readFileSync(launcher, "utf8")).toBe(LAUNCHER);
    expect(statSync(launcher).mode & 0o777).toBe(0o755);
    const text = injected(out);
    // The primer names the launcher the copy wrote (D1).
    expect(text.endsWith(`\n\n${line(p.skill)}\n\n${primer(shellWord(launcher))}`)).toBe(true);
    // The FAIL lines and the primer name the launcher, not the installed CLI it replaces.
    r.apply(r.fail());
    const news = await runAntigravityHook(
      "pre-invocation",
      antigravityRecorded("pre-invocation-after-tools", r.root),
      { ...p.deps, command: shellWord(launcher) },
    );
    expect(injected(news)).toContain(`${shellWord(launcher)} why`);
  });

  it("spawns the daemon from the copy", async () => {
    const p = plugin();
    const r = squealRepo();
    r.daemon("none");
    r.apply(r.pass());
    await runAntigravityHook("session-start", antigravityRecorded("session-start", r.root), p.deps);
    expect(p.spawned.map((o) => o.cli)).toEqual([join(p.copy, "dist", "cli", "squeal.mjs")]);
  });

  it("prunes old copies: keeps the newest prior one and one made within 24 h", async () => {
    const p = plugin();
    const day = 24 * 60 * 60 * 1000;
    const oldest = oldCopy(p.data, "0.1.700", 3 * day);
    const recent = oldCopy(p.data, "0.1.750", 60_000);
    const prior = oldCopy(p.data, "0.1.800", 2 * day);
    const r = squealRepo();
    r.apply(r.pass());
    await runAntigravityHook("session-start", antigravityRecorded("session-start", r.root), p.deps);
    expect(existsSync(p.copy)).toBe(true);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(prior)).toBe(true);
  });

  it("makes no copy from a root whose plugin.json names another version (row 011-140)", async () => {
    const p = plugin("0.1.899");
    const r = squealRepo();
    r.apply(r.pass());
    const out = await runAntigravityHook(
      "session-start",
      antigravityRecorded("session-start", r.root),
      p.deps,
    );
    expect(existsSync(join(p.data, "versions"))).toBe(false);
    expect(injected(out)).not.toContain("kept across plugin updates");
  });

  it("keeps nothing without PLUGIN_DATA, as a workspace plugin runs", async () => {
    const p = plugin();
    const r = squealRepo();
    r.apply(r.pass());
    const deps = { ...p.deps, env: { PLUGIN_ROOT: p.root } };
    const out = await runAntigravityHook(
      "session-start",
      antigravityRecorded("session-start", r.root),
      deps,
    );
    expect(existsSync(p.data)).toBe(false);
    expect(injected(out)).not.toContain("kept across plugin updates");
  });
});

describe("the other hooks (row 005-81 and 005-83 rules)", () => {
  it("keepOnSpawn keeps the copy and spawns from it when no daemon answers", async () => {
    const p = plugin();
    const worktree = tempDir("squeal-agy-worktree-");
    const options: Options = {
      socketTimeoutMs: 100,
      cli: p.deps.cli ?? "",
      record: null,
      env: { XDG_RUNTIME_DIR: runtimeDir() },
    };
    expect(await keepOnSpawn(p.deps).ensureDaemon?.(worktree, options)).toBe("spawned");
    expect(p.spawned.map((o) => o.cli)).toEqual([join(p.copy, "dist", "cli", "squeal.mjs")]);
    // Once a copy exists, deps are left as they are.
    expect(keepOnSpawn(p.deps)).toBe(p.deps);
  });

  it("a PreInvocation that registers keeps the copy and names its skill; a delta copies nothing", async () => {
    const p = plugin();
    const deps = { ...p.deps, ensureDaemon: async () => "alive" as const };
    const r = squealRepo();
    r.apply(r.pass());
    const first = await runAntigravityHook(
      "pre-invocation",
      antigravityRecorded("pre-invocation-first", r.root),
      deps,
    );
    expect(injected(first).endsWith(`\n\n${line(p.skill)}\n\n${primer(deps.command)}`)).toBe(true);
    expect(registeredSkillLine("SQUEAL · revision 2\nmath > adds failed", deps)).toBe("");
  });
});
