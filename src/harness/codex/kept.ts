import { squealVersion } from "../../core/daemon/version.js";
import type { HookDeps } from "../shared/hook.js";
import { keepVersion, keptCli, keptSkill } from "../shared/version-copies.js";
import { codexCommand } from "./command.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73): a Codex hook runs from its
 * version's copy in the plugin data directory once one is kept, since Codex's
 * install of another version deletes this one's cache directory. Codex names
 * the directory to hooks as `PLUGIN_DATA` (`research/plugin-cache-cleanup.md`
 * 2); a hook a launcher declares has neither it nor `PLUGIN_ROOT`, and runs
 * from the cache as before.
 */

type Env = Readonly<Record<string, string | undefined>>;

const set = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

/** The CLI of this version's copy, `null` before SessionStart kept one. */
export function keptCodexCli(env: Env, version: string = squealVersion()): string | null {
  const data = set(env.PLUGIN_DATA);
  return data === null ? null : keptCli(data, version);
}

/**
 * SessionStart, before it ensures the daemon: keeps this version's copy
 * (`keepVersion`) and returns `deps` with the copy's CLI, the daemon a hook
 * spawns, so a tier loads the copy's recorder and reporters, and the command
 * that names the launcher. `deps` as they are when no copy could be made, as
 * at the first hook of a new install.
 */
export function keepCodexVersion(deps: HookDeps): HookDeps {
  const root = set(deps.env.PLUGIN_ROOT);
  const data = set(deps.env.PLUGIN_DATA);
  if (root === null || data === null) return deps;
  const version = deps.squealVersion ?? squealVersion();
  if (keepVersion({ root, data, version }) === null) return deps;
  const cli = keptCli(data, version) ?? deps.cli;
  return cli === undefined ? deps : { ...deps, cli, command: codexCommand(deps.env, cli) };
}

/**
 * The line Codex's SessionStart and SubagentStart put before the primer,
 * naming the copy of the skill: Codex's skill catalog keeps naming the cache
 * directory a later install deletes (005-73, the coordinator's answer to Q2).
 * `""` without a copy.
 */
export function skillLine(deps: HookDeps): string {
  const data = set(deps.env.PLUGIN_DATA);
  const skill = data === null ? null : keptSkill(data, deps.squealVersion ?? squealVersion());
  return skill === null
    ? ""
    : `Squeal's skill for this session, kept across plugin updates: \`${skill}\`.`;
}
