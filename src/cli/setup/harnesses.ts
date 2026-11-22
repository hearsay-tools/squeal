import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { claudeLoaded, codexNewest } from "../../core/daemon/version.js";
import {
  ANTIGRAVITY_INSTALL_COMMAND,
  antigravityCli,
  antigravityPlugin,
} from "../antigravity/install.js";
import { MARKETPLACE_NAME, MARKETPLACE_REPO, PLUGIN_ID } from "../plugin-id.js";

/*
 * Spec 005 D3 step 1: the harnesses on the PATH and whether each has the
 * plugin. Read from the harnesses' own files, which Squeal never writes
 * (002 D1): Claude Code's `installed_plugins.json` and the Codex plugin cache.
 * Antigravity (spec 024 D6) is listed only when its CLI or plugin is found,
 * from `~/.gemini/config/`.
 */

export type HarnessId = "claude-code" | "codex" | "antigravity";

export interface HarnessFact {
  readonly id: HarnessId;
  /** The harness's CLI, `claude`, `codex` or Antigravity's (`antigravityCli`), is on the PATH. */
  readonly onPath: boolean;
  /**
   * The plugin this directory loads; `null` when none is installed for it.
   * `disabled` only for Antigravity: its `config.json` disables the plugin.
   */
  readonly plugin: {
    readonly version: string;
    readonly scope: string;
    readonly disabled?: boolean;
  } | null;
  /** What installs the plugin through the harness's own CLI (D3, `install.sh` step 2). */
  readonly installCommands: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

export function readHarnesses(root: string, env: Env): HarnessFact[] {
  return [
    {
      id: "claude-code",
      onPath: onPath("claude", env),
      plugin: claudeCodePlugin(root, env),
      installCommands: [
        `claude plugin marketplace add ${MARKETPLACE_REPO}`,
        `claude plugin install ${PLUGIN_ID}`,
      ],
    },
    {
      id: "codex",
      onPath: onPath("codex", env),
      plugin: codexPlugin(env),
      installCommands: [
        `codex plugin marketplace add ${MARKETPLACE_REPO}`,
        `codex plugin add ${PLUGIN_ID}`,
      ],
    },
    ...antigravityFact(env),
  ];
}

/** Antigravity's fact when its CLI passes detection or its plugin is installed; none otherwise. */
function antigravityFact(env: Env): HarnessFact[] {
  const cli = antigravityCli(env) !== null;
  const installed = antigravityPlugin(env);
  if (!cli && installed === null) return [];
  const plugin =
    installed === null
      ? null
      : { version: installed.version, scope: "user", disabled: installed.disabled };
  return [
    { id: "antigravity", onPath: cli, plugin, installCommands: [ANTIGRAVITY_INSTALL_COMMAND] },
  ];
}

function onPath(name: string, env: Env): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      // Not in this directory.
    }
  }
  return false;
}

/**
 * The first entry of `installed_plugins.json["squeal@hearsay"]` that is user
 * scope, or project scope for `root`: the one a session here loads
 * (`research/wave-0-checks.md` 5).
 */
function claudeCodePlugin(root: string, env: Env): HarnessFact["plugin"] {
  const configDir = env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? "", ".claude");
  return claudeLoaded(join(configDir, "plugins"), MARKETPLACE_NAME, root);
}

/** The newest version directory of `<CODEX_HOME>/plugins/cache/hearsay/squeal/`. */
export function codexPlugin(env: Env): HarnessFact["plugin"] {
  const home = env.CODEX_HOME ?? join(env.HOME ?? "", ".codex");
  const newest = codexNewest(join(home, "plugins"), MARKETPLACE_NAME);
  return newest === null ? null : { version: newest, scope: "user" };
}

/** Orders dotted numeric versions. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
