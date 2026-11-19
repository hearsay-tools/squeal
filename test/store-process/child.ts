import { startStoreProcess } from "../../src/core/store-process/server.js";
import { writerScript } from "../../src/core/store-process/writer.js";

/*
 * Row 021-36: the store process in a process of its own, as a daemon
 * starts it, without loading the whole CLI: `child.ts <common dir>
 * [<grace ms> <check ms> [<report ms>]]`. A test stops it (SIGSTOP) or kills it, so it
 * cannot run in the test's own process.
 * Prints `ready` once it serves, its log lines to stderr, `ended <why>` at
 * its end.
 */

// A last argument `store-process` only names it so in its command line (`ps`, a relay's holder lookup).
const [commonDir, grace, check, report] = process.argv
  .slice(2)
  .filter((arg) => arg !== "store-process");
if (commonDir === undefined)
  throw new Error("usage: child.ts <common dir> [<grace ms> <check ms> [<report ms>]]");
const started = await startStoreProcess({
  commonDir,
  log: (line) => process.stderr.write(`${line}\n`),
  writer: writerScript(),
  ...(grace === undefined ? {} : { graceMs: Number(grace) }),
  ...(check === undefined ? {} : { checkMs: Number(check) }),
  ...(report === undefined ? {} : { reportMs: Number(report) }),
});
if (typeof started === "string") {
  process.stdout.write(`ended ${started}\n`);
} else {
  process.stdout.write("ready\n");
  process.once("SIGTERM", () => void started.stop());
  process.stdout.write(`ended ${await started.ended}\n`);
}
