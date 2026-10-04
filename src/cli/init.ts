import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorktreeRoot } from "../core/status/index.js";
import { DEFAULT_POLICY } from "../core/types/index.js";
import type { CliIo } from "./main.js";

/*
 * `squeal init`, spec 001 D9: "adds the marketplace and the `enabledPlugins`
 * entry to project settings and writes `squeal.config.json` if absent. It
 * never writes raw hook commands into user-owned settings."
 */

/** Marketplace and plugin name; the plugin id is `squeal@squeal`. */
export const MARKETPLACE_NAME = "squeal";
export const PLUGIN_ID = `squeal@${MARKETPLACE_NAME}`;

/** This repository, whose plugins/claude-code is the marketplace root. */
export const MARKETPLACE_SOURCE = {
  source: { source: "github", repo: "hearsay-tools/squeal", path: "plugins/claude-code" },
} as const;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Exit 0 when the repository is set up (including when nothing changed), 1
 * when settings cannot be read or the directory is not in a git worktree, 2 on
 * a usage error. Nothing is written unless every file can be.
 */
export function init(args: readonly string[], io: CliIo): number {
  if (args.length > 0) {
    io.stderr("squeal init: takes no arguments\n\nUsage: squeal init\n");
    return 2;
  }
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
    if (!isObject(value)) {
      io.stderr(`squeal init: ${key} in ${settingsPath} is not an object; nothing changed\n`);
      return 1;
    }
  }

  const lines: string[] = [];
  const configPath = join(root, "squeal.config.json");
  if (existsSync(configPath)) {
    lines.push("kept squeal.config.json");
  } else {
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
    lines.push("wrote squeal.config.json with every default policy key");
  }

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
  if (text !== settings.text) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath, text);
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
  if (!isObject(value)) return `${path} is not a JSON object`;
  return { value, text, indent: /^([ \t]+)"/m.exec(text)?.[1] ?? 2 };
}
