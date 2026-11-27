import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { CommandNeed, RequiredCommands } from "../types/policy.js";

/*
 * Spec 021 D19.1 (row 021-23): `requires.commands`, the commands the
 * project's tests need on `PATH`. The daemon looks for them when it starts
 * and when the policy changes; one missing here is named in status, and the
 * tests still run. A remote lane looks for them on the remote at each
 * connect, with `MISSING_SCRIPT` under the remote's Node, and a missing one
 * refuses the remote with the same text. Whether a test needs the
 * repository's `.git` is a separate setting (`remote.needsRepository`).
 *
 * Spec 026 D13.2 (row 026-36): the object form maps test-file globs to the
 * commands their files need; `"*"` is every file, as the array form. Here
 * every name of either form is looked for, as before. On a remote a
 * missing `"*"` command refuses it; a glob's keeps only its files here
 * (`remote/lane-commands.ts`).
 */

/** What `requires.commands` needs, in one shape: of every file, and per test-file glob. */
export interface CommandNeeds {
  /** The array form, and the object form's `"*"`: a remote without one is refused. */
  readonly all: readonly CommandNeed[];
  /** The object form's other globs, in order, each with the commands its files need. */
  readonly files: readonly { readonly glob: string; readonly needs: readonly CommandNeed[] }[];
}

/** `commands` in one shape (`CommandNeeds`). */
export function commandNeeds(commands: RequiredCommands): CommandNeeds {
  const need = (entry: string | CommandNeed): CommandNeed =>
    typeof entry === "string" ? { command: entry } : entry;
  if (isCommandList(commands)) return { all: commands.map(need), files: [] };
  const files = Object.entries(commands)
    .filter(([glob]) => glob !== "*")
    .map(([glob, entries]) => ({ glob, needs: entries.map(need) }));
  return { all: (commands["*"] ?? []).map(need), files };
}

function isCommandList(commands: RequiredCommands): commands is readonly string[] {
  return Array.isArray(commands);
}

/** Every command name `needs` holds, once each, in order. */
export function commandNames(needs: CommandNeeds): string[] {
  const all = [...needs.all, ...needs.files.flatMap((file) => file.needs)];
  return [...new Set(all.map((need) => need.command))];
}

/**
 * The first line `command version` prints here, stdout's or else stderr's,
 * trimmed; `null` when it cannot run. D13.2's version check compares it with
 * the remote's.
 */
export function versionHere(
  need: CommandNeed & { readonly version: string },
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const ran = spawnSync(need.command, [need.version], { env, encoding: "utf8", timeout: 30_000 });
  if (ran.error !== undefined) return null;
  return firstLine(ran.stdout, ran.stderr);
}

/** The first non-empty line of `stdout`, else of `stderr`, trimmed; `""` when both are empty. */
export function firstLine(stdout: string, stderr: string): string {
  const first = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "");
  return first(stdout) ?? first(stderr) ?? "";
}

/** The note topic of the daemon's one status line about them. */
export const COMMANDS_TOPIC = "requires:commands";

/** Of `commands`, those no directory of `env.PATH` holds as an executable file, in order. */
export function missingCommands(
  commands: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const dirs = (env.PATH ?? "").split(delimiter).filter((dir) => dir !== "");
  return commands.filter((command) => !dirs.some((dir) => executable(join(dir, command))));
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * `missingCommands` on the remote: `node -e MISSING_SCRIPT <name>...` prints
 * the JSON list of the names its `PATH` lacks, the same test as here.
 */
export const MISSING_SCRIPT = [
  'const fs=require("fs"),path=require("path");',
  'const dirs=(process.env.PATH||"").split(path.delimiter).filter((d)=>d!=="");',
  "const ok=(p)=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile();}catch{return false;}};",
  "process.stdout.write(JSON.stringify(process.argv.slice(1).filter((c)=>!dirs.some((d)=>ok(path.join(d,c))))));",
].join("");

/** D19.1's named text: `tests need python3; not found on PATH here`. */
export function missingText(missing: readonly string[], where: "here" | "there"): string {
  return `tests need ${missing.join(", ")}; not found on PATH ${where}`;
}

/**
 * The status line of the daemon's check now, or `null` when `last`, the
 * topic's latest, already says it, or nothing was ever missing.
 */
export function commandsLine(
  required: RequiredCommands,
  last: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const commands = commandNames(commandNeeds(required));
  const missing = missingCommands(commands, env);
  let text: string | null;
  if (missing.length > 0) text = missingText(missing, "here");
  else if (last === undefined) text = null;
  else if (commands.length === 0) text = "tests need no command (requires.commands is empty)";
  else text = `tests need ${commands.join(", ")}; all found on PATH here`;
  return text === last ? null : text;
}
