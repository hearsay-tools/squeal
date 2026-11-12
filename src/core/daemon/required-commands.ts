import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/*
 * Spec 021 D19.1 (row 021-23): `requires.commands`, the commands the
 * project's tests need on `PATH`. The daemon looks for them when it starts
 * and when the policy changes; one missing here is named in status, and the
 * tests still run. A remote lane looks for them on the remote at each
 * connect, with `MISSING_SCRIPT` under the remote's Node, and a missing one
 * refuses the remote with the same text. Whether a test needs the
 * repository's `.git` is a separate setting (`remote.needsRepository`).
 */

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
  commands: readonly string[],
  last: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const missing = missingCommands(commands, env);
  let text: string | null;
  if (missing.length > 0) text = missingText(missing, "here");
  else if (last === undefined) text = null;
  else if (commands.length === 0) text = "tests need no command (requires.commands is empty)";
  else text = `tests need ${commands.join(", ")}; all found on PATH here`;
  return text === last ? null : text;
}
