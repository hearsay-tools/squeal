#!/usr/bin/env node
import { psCommand } from "./ps.js";

/*
 * Spec 014 goal 6 and D11 (row 014-33): the entry of `dist/cli/ps.mjs`, which
 * the plugins' `bin/squeal` and the launcher run for `squeal ps`. It loads
 * only `ps`'s code: the whole CLI, `squeal.mjs`, cost 0.04 to 0.10 s of CPU
 * more to load. Any other command, and `ps --help`, goes to the whole CLI
 * beside it, so this file answers as `squeal.mjs` does.
 */

const [command, ...rest] = process.argv.slice(2);
if (command !== "ps" || rest.includes("--help") || rest.includes("-h")) {
  await import(new URL("squeal.mjs", import.meta.url).href);
} else {
  // As `index.ts`: a reader that closed early (`squeal ps | head -1`) is not an error.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  process.exitCode = await psCommand(rest, {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
  });
}
