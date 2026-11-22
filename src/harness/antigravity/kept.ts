import { ensureDaemon, probeDaemon } from "../../core/daemon/ensure.js";
import { squealVersion } from "../../core/daemon/version.js";
import type { HookDeps } from "../shared/hook.js";
import { trailingPrimer } from "../shared/primer.js";
import {
  ANTIGRAVITY_COPIED,
  ANTIGRAVITY_MANIFEST,
  keepVersion,
  keptCli,
  keptSkill,
} from "../shared/version-copies.js";
import { antigravityCommand } from "./command.js";

/*
 * Spec 024 D1, as `src/harness/codex/kept.ts` does for Codex: `plugin install`
 * replaces `~/.gemini/config/plugins/squeal/` in place, deleting the `dist/`
 * an earlier session's daemon runs from. So a hook keeps its version's copy
 * of `PLUGIN_ROOT` in `PLUGIN_DATA`, which Antigravity keeps across reinstall
 * and uninstall (`research/wave-0-checks.md` 2), and runs from it once kept.
 * The plugin's manifest is `plugin.json` at its root, so every copy uses the
 * Antigravity layout. A hook without `PLUGIN_ROOT` and `PLUGIN_DATA` (a
 * workspace plugin) runs from the installed plugin as before.
 */

type Env = Readonly<Record<string, string | undefined>>;

const LAYOUT = { manifest: ANTIGRAVITY_MANIFEST, copied: ANTIGRAVITY_COPIED } as const;

const set = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

/** The CLI of this version's copy, `null` before a hook kept one. */
export function keptAntigravityCli(env: Env, version: string = squealVersion()): string | null {
  const data = set(env.PLUGIN_DATA);
  return data === null ? null : keptCli(data, version, LAYOUT);
}

/** Keeps `version`'s copy of `PLUGIN_ROOT` (`keepVersion`): its CLI, `null` when none could be made. */
function keepAntigravityCli(env: Env, version: string): string | null {
  const root = set(env.PLUGIN_ROOT);
  const data = set(env.PLUGIN_DATA);
  if (root === null || data === null) return null;
  return keepVersion({ root, data, version, ...LAYOUT }) === null
    ? null
    : keptCli(data, version, LAYOUT);
}

/**
 * SessionStart, before it ensures the daemon: keeps this version's copy and
 * returns `deps` with the copy's CLI, the daemon a hook spawns, and the
 * command that names the launcher the copy wrote. `deps` as they are when no
 * copy could be made.
 */
export function keepAntigravityVersion(deps: HookDeps): HookDeps {
  const cli = keepAntigravityCli(deps.env, deps.squealVersion ?? squealVersion());
  return cli === null ? deps : { ...deps, cli, command: antigravityCommand(deps.env, cli) };
}

/**
 * Every other hook, before its version's copy exists (row 005-81's rule):
 * keeps the copy only when it spawns a daemon, and spawns it from the copy.
 * It probes as `ensureDaemon` does, so a hook whose daemon answers or holds
 * the lock copies nothing; a successor after a handoff (`awaitLockMs`)
 * spawns without a probe. `deps` as they are once a copy exists, or without
 * `PLUGIN_ROOT` and `PLUGIN_DATA`.
 */
export function keepOnSpawn(deps: HookDeps): HookDeps {
  const version = deps.squealVersion ?? squealVersion();
  const data = set(deps.env.PLUGIN_DATA);
  if (
    set(deps.env.PLUGIN_ROOT) === null ||
    data === null ||
    keptCli(data, version, LAYOUT) !== null
  ) {
    return deps;
  }
  const ensure = deps.ensureDaemon ?? ensureDaemon;
  return {
    ...deps,
    ensureDaemon: async (root, options) => {
      if (options.awaitLockMs === undefined) {
        const probe = await probeDaemon(root, options.socketTimeoutMs, options);
        if (probe.state === "alive") return "alive";
        if (probe.state === "unresponsive") return "unavailable";
      }
      const cli = keepAntigravityCli(deps.env, version);
      return ensure(root, cli === null ? options : { ...options, cli });
    },
  };
}

/** The line put before the primer naming the kept copy of the skill; `""` without a copy. */
export function skillLine(deps: HookDeps): string {
  const data = set(deps.env.PLUGIN_DATA);
  const version = deps.squealVersion ?? squealVersion();
  const skill = data === null ? null : keptSkill(data, version, LAYOUT);
  return skill === null
    ? ""
    : `Squeal's skill for this session, kept across plugin updates: \`${skill}\`.`;
}

/**
 * The skill line for a PreInvocation text (row 005-83's rule): only a text
 * that registers the consumer ends with the primer, and it keeps this
 * version's copy first when none exists, as SessionStart does. `""` for a
 * text that registers nothing.
 */
export function registeredSkillLine(text: string, deps: HookDeps): string {
  if (trailingPrimer(text) === "") return "";
  const version = deps.squealVersion ?? squealVersion();
  const data = set(deps.env.PLUGIN_DATA);
  if (data !== null && keptCli(data, version, LAYOUT) === null) {
    keepAntigravityCli(deps.env, version);
  }
  return skillLine(deps);
}
