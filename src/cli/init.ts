import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorktreeRoot, isRecord } from "../core/fs/index.js";
import { DEFAULT_POLICY } from "../core/types/index.js";
import { initCodex, printLauncherConfig } from "./codex/init.js";
import type { CliIo } from "./main.js";

/*
 * `squeal init`, spec 001 D9: "adds the marketplace and the `enabledPlugins`
 * entry to project settings and writes `squeal.config.json` if absent. It
 * never writes raw hook commands into user-owned settings."
 */

/** Marketplace and plugin name; the plugin id is `squeal@squeal`. */
export const MARKETPLACE_NAME = "squeal";
export const PLUGIN_ID = `squeal@${MARKETPLACE_NAME}`;

/**
 * This repository. Its `.claude-plugin/marketplace.json` is at the root, the
 * default `path`, and lists the plugin as `./plugins/claude-code`: Claude
 * Code 2.1.288 resolves plugin sources of a `github` marketplace against the
 * clone root, not against the directory holding the manifest (review wave 3,
 * S4).
 */
export const MARKETPLACE_SOURCE = {
  source: { source: "github", repo: "hearsay-tools/squeal" },
} as const;

type JsonObject = Record<string, unknown>;

/**
 * Exit 0 when the repository is set up (including when nothing changed), 1
 * when settings cannot be read or written or the directory is not in a git
 * worktree, 2 on a usage error. Settings are written first and restored when
 * the config cannot be written, so a failure changes nothing. With
 * `--harness codex`, see `initCodex`.
 */
export function init(args: readonly string[], io: CliIo): number {
  const parsed = parseInitArgs(args);
  if (typeof parsed === "string") {
    io.stderr(`squeal init: takes no arguments but those below; ${parsed}\n\n${INIT_USAGE}`);
    return 2;
  }
  if (parsed.harness === "codex") {
    return parsed.printLauncherConfig ? printLauncherConfig(io) : initCodex(io);
  }
  return initClaudeCode(io);
}

const INIT_USAGE = `Usage: squeal init [--harness claude-code]
       squeal init --harness codex [--print-launcher-config]
`;

interface InitArgs {
  readonly harness: "claude-code" | "codex";
  readonly printLauncherConfig: boolean;
}

/** Spec 002 D1: no `--harness` keeps the Claude Code behaviour. */
function parseInitArgs(args: readonly string[]): InitArgs | string {
  let harness: string = "claude-code";
  let printLauncher = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--print-launcher-config") printLauncher = true;
    else if (arg.startsWith("--harness=")) harness = arg.slice("--harness=".length);
    else if (arg === "--harness") {
      const value = args[++i];
      if (value === undefined) return "--harness takes claude-code or codex";
      harness = value;
    } else return `unknown argument "${arg}"`;
  }
  if (harness !== "claude-code" && harness !== "codex") {
    return `unknown harness "${harness}": claude-code or codex`;
  }
  if (printLauncher && harness !== "codex") return "--print-launcher-config needs --harness codex";
  return { harness, printLauncherConfig: printLauncher };
}

function initClaudeCode(io: CliIo): number {
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal init: ${cwd} is not inside a git worktree\n`);
    return 1;
  }

  const settingsPath = join(root, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  if (typeof settings === "string") {
    io.stderr(`squeal init: ${settings}; nothing changed\n`);
    return 1;
  }
  const marketplaces = settings.value.extraKnownMarketplaces ?? {};
  const plugins = settings.value.enabledPlugins ?? {};
  for (const [key, value] of [
    ["extraKnownMarketplaces", marketplaces],
    ["enabledPlugins", plugins],
  ] as const) {
    if (!isRecord(value)) {
      io.stderr(`squeal init: ${key} in ${settingsPath} is not an object; nothing changed\n`);
      return 1;
    }
  }

  const lines: string[] = [];
  const configPath = join(root, "squeal.config.json");
  const writeConfig = !existsSync(configPath);
  lines.push(
    writeConfig
      ? "wrote squeal.config.json with every default policy key"
      : "kept squeal.config.json",
  );

  const next: JsonObject = { ...settings.value };
  const marketplaceEntries = marketplaces as JsonObject;
  if (MARKETPLACE_NAME in marketplaceEntries) {
    lines.push("kept the squeal marketplace entry in .claude/settings.json");
  } else {
    next.extraKnownMarketplaces = { ...marketplaceEntries, [MARKETPLACE_NAME]: MARKETPLACE_SOURCE };
    lines.push("added the squeal marketplace to .claude/settings.json");
  }
  const pluginEntries = plugins as JsonObject;
  if (pluginEntries[PLUGIN_ID] === true) {
    lines.push(`.claude/settings.json already enables ${PLUGIN_ID}`);
  } else {
    next.enabledPlugins = { ...pluginEntries, [PLUGIN_ID]: true };
    lines.push(`enabled ${PLUGIN_ID} in .claude/settings.json`);
  }

  const text = `${JSON.stringify(next, null, settings.indent)}\n`;
  const restore = text === settings.text ? () => {} : restorer(settingsPath, settings.text);
  try {
    if (text !== settings.text) {
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(settingsPath, text);
    }
  } catch (error) {
    restore();
    io.stderr(`squeal init: could not write ${settingsPath}: ${reason(error)}; nothing changed\n`);
    return 1;
  }
  try {
    if (writeConfig) writeFileSync(configPath, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
  } catch (error) {
    restore();
    io.stderr(`squeal init: could not write ${configPath}: ${reason(error)}; nothing changed\n`);
    return 1;
  }
  io.stdout(
    [
      ...lines.map((line) => `squeal init: ${line}`),
      `Each collaborator installs the plugin once: claude plugin install ${PLUGIN_ID} --scope project`,
      "",
    ].join("\n"),
  );
  return 0;
}

/** Puts settings.json back as it was read: the old text, or no file. */
function restorer(path: string, text: string | null): () => void {
  return () => {
    try {
      if (text === null) rmSync(path, { force: true });
      else writeFileSync(path, text);
    } catch {
      // The write that failed first is the error reported; this one adds nothing.
    }
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Settings {
  readonly value: JsonObject;
  /** The file as read; `null` when it does not exist. */
  readonly text: string | null;
  /** Indentation of the existing file, kept on rewrite. */
  readonly indent: string | number;
}

/** The settings object, or why it cannot be used. */
function readSettings(path: string): Settings | string {
  if (!existsSync(path)) return { value: {}, text: null, indent: 2 };
  const text = readFileSync(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (!isRecord(value)) return `${path} is not a JSON object`;
  return { value, text, indent: /^([ \t]+)"/m.exec(text)?.[1] ?? 2 };
}
