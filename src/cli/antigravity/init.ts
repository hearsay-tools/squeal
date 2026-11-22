import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorktreeRoot } from "../../core/fs/git-layout.js";
import { DEFAULT_POLICY } from "../../core/types/policy.js";
import type { CliIo } from "../main.js";
import { type NodeTestSeed, seedNodeTest } from "../node-test-seed.js";
import { ANTIGRAVITY_DISABLED, ANTIGRAVITY_INSTALL_COMMAND, antigravityPlugin } from "./install.js";

/*
 * `squeal init --harness antigravity`, spec 024 D6: Antigravity owns
 * `~/.gemini/config/`, so Squeal writes only `squeal.config.json` and prints
 * the command through which Antigravity installs the plugin (D1).
 */

/** Exit 0 when the repository is set up, 1 outside a git worktree or when the config cannot be written. */
export function initAntigravity(io: CliIo): number {
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal init: ${cwd} is not inside a git worktree\n`);
    return 1;
  }
  const configPath = join(root, "squeal.config.json");
  const writeConfig = !existsSync(configPath);
  // Spec 003 D1: a new config gets the node:test projects of the repository's own scripts.
  let seed: NodeTestSeed = { projects: [], notes: [], templates: [] };
  try {
    if (writeConfig) {
      seed = seedNodeTest(root);
      const config = { ...DEFAULT_POLICY, nodeTest: seed.projects };
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.stderr(`squeal init: could not write ${configPath}: ${reason}; nothing changed\n`);
    return 1;
  }
  const plugin = antigravityPlugin(io.env ?? process.env);
  io.stdout(
    [
      `squeal init: ${writeConfig ? "wrote squeal.config.json with every default policy key" : "kept squeal.config.json"}`,
      ...seed.notes,
      ...(seed.templates.length === 0
        ? []
        : ["nodeTest entries to complete by hand:", JSON.stringify(seed.templates, null, 2)]),
      ...(plugin === null
        ? [
            "Each user installs the Antigravity plugin once; Antigravity writes its own config:",
            `  ${ANTIGRAVITY_INSTALL_COMMAND}`,
          ]
        : plugin.disabled
          ? [`Antigravity has the plugin ${plugin.version}, but ${ANTIGRAVITY_DISABLED}.`]
          : []),
      "",
    ].join("\n"),
  );
  return 0;
}
