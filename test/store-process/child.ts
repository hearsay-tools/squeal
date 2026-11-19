import { startStoreProcess } from "../../src/core/store-process/server.js";
import { writerScript } from "../../src/core/store-process/writer.js";

/*
 * Row 021-36: the store process in a process of its own, as a daemon
 * starts it, without loading the whole CLI: `child.ts <common dir>
 * [<grace ms> <check ms>]`. A daemon's main thread waits for its batches,
 * so a store process inside the test's own process could never answer.
 * Prints `ready` once it serves, its log lines to stderr, `ended <why>` at
 * its end.
 */

const [commonDir, grace, check] = process.argv.slice(2);
if (commonDir === undefined)
  throw new Error("usage: child.ts <common dir> [<grace ms> <check ms>]");
const started = await startStoreProcess({
  commonDir,
  log: (line) => process.stderr.write(`${line}\n`),
  writer: writerScript(),
  ...(grace === undefined ? {} : { graceMs: Number(grace) }),
  ...(check === undefined ? {} : { checkMs: Number(check) }),
});
if (typeof started === "string") {
  process.stdout.write(`ended ${started}\n`);
} else {
  process.stdout.write("ready\n");
  process.once("SIGTERM", () => void started.stop());
  process.stdout.write(`ended ${await started.ended}\n`);
}
