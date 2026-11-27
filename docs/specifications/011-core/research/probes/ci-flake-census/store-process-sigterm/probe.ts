// Throwaway probe (row 011-428, board row ci-46051074967). Repeats the steps of
// test/store-process/logs.test.ts "writes the store process's lines to its own log file":
// spawn, wait for "serving", SIGTERM, wait for exit, read the log. Three cases:
//   hold:    the preload holds the main thread just after "serving"; SIGTERM at once.
//   at-once: no hold; SIGTERM as soon as the line shows (the test's own order).
//   late:    no hold; SIGTERM 1 s after the line.
// Run from the repository root: node --import tsx <this file> <case>
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { storeProcessLogPath } from "../../../../../../../src/core/store-process/paths.js";
import { spawnStoreProcess } from "../../../../../../../src/core/store-process/spawn.js";
import { clone, LAUNCH } from "../../../../../../../test/store-process/helpers.js";

const which = process.argv[2] ?? "hold";
const hold = pathToFileURL(fileURLToPath(new URL("./hold-after-serving.mjs", import.meta.url))).href;
const launch = which === "hold" ? { ...LAUNCH, execArgv: [...LAUNCH.execArgv, "--import", hold] } : LAUNCH;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = clone();
try {
  const pid = spawnStoreProcess(at.commonDir, launch, at.env) as number;
  const log = storeProcessLogPath(at.commonDir, "code");
  const read = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const start = Date.now();
  while (!/store process: serving /.test(read())) {
    if (Date.now() - start > 120_000) throw new Error("never served");
    await sleep(10);
  }
  if (which === "late") await sleep(1_000);
  process.kill(pid, "SIGTERM");
  while (alive(pid)) await sleep(10);
  const text = read();
  console.log(
    JSON.stringify({
      case: which,
      node: process.version,
      stoppingLine: /store process: stopping \(stopped\)/.test(text),
      lines: text.trim().split("\n").map((l) => l.replace(/^\S+Z \[\d+\] /, "").slice(0, 60)),
    }),
  );
} finally {
  await at.cleanup();
}
