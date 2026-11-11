#!/usr/bin/env node
import { main } from "./main.js";

// Review wave 3, N6: a reader that closed early (`squeal start | head -1`) is not an error of
// this command. Output to it is dropped; anything else on stdout still surfaces.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") throw error;
});

const script = process.argv[1];
process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  // Spec 020 D14.4 (#182): `squeal code --base --json` runs its collection in a child of this script.
  ...(script === undefined ? {} : { relaunch: [process.execPath, ...process.execArgv, script] }),
});
