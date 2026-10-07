import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorktreeRoot } from "../../core/fs/index.js";
import { DEFAULT_POLICY } from "../../core/types/index.js";
import type { CliIo } from "../main.js";
import { findCodexPlugin, launcherConfig, readPluginHooks } from "./launcher.js";

/*
 * `squeal init --harness codex`, spec 002 D1 and goal 8: Codex loads plugins
 * only from its own cache and config, so Squeal writes nothing under
 * `~/.codex`; it prints the commands through which Codex makes those writes,
 * and the trust step.
 */

/** This repository as a Codex marketplace source; its `.agents/plugins/marketplace.json`. */
export const CODEX_MARKETPLACE_SOURCE = "hearsay-tools/squeal";
export const CODEX_PLUGIN_ID = "squeal@squeal";

/** The trust step, also named by `squeal status` (spec 002 D6). */
export const CODEX_TRUST_STEP = `open the Codex TUI, run /hooks and trust the hooks of ${CODEX_PLUGIN_ID}`;

/**
 * Exit 0 when the repository is set up, 1 when the directory is not in a git
 * worktree or the config cannot be written.
 */
export function initCodex(io: CliIo): number {
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal init: ${cwd} is not inside a git worktree\n`);
    return 1;
  }
  const configPath = join(root, "squeal.config.json");
  const writeConfig = !existsSync(configPath);
  try {
    if (writeConfig) writeFileSync(configPath, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`squeal init: could not write ${configPath}: ${reason}; nothing changed\n`);
    return 1;
  }
  io.stdout(
    [
      `squeal init: ${writeConfig ? "wrote squeal.config.json with every default policy key" : "kept squeal.config.json"}`,
      "Each user installs the Codex plugin once; Codex writes its own config:",
      `  codex plugin marketplace add ${CODEX_MARKETPLACE_SOURCE}`,
      `  codex plugin add ${CODEX_PLUGIN_ID}`,
      `Then trust its hooks once: ${CODEX_TRUST_STEP}. Codex skips untrusted hooks silently.`,
      "",
    ].join("\n"),
  );
  return 0;
}

/**
 * `squeal init --harness codex --print-launcher-config`: the `thread/start`
 * `config` object as JSON on stdout, its hashes as Codex 0.160.1 computes
 * them (`CODEX_HASH_VERSION`). Writes nothing. Exit 1 when the Codex
 * plugin is not found beside this CLI.
 */
export function printLauncherConfig(io: CliIo, pluginRoot = findCodexPlugin()): number {
  if (pluginRoot === null) {
    io.stderr("squeal init: the Codex plugin (plugins/codex) is not installed beside this CLI\n");
    return 1;
  }
  let config: Record<string, unknown>;
  try {
    config = launcherConfig(pluginRoot, readPluginHooks(pluginRoot));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`squeal init: cannot build the launcher config: ${reason}\n`);
    return 1;
  }
  io.stdout(`${JSON.stringify(config, null, 2)}\n`);
  return 0;
}
