/*
 * `squeal daemon <root>` from the sources with its first prune at once, for
 * `shared-store.test.ts`: a second daemon whose start-up work is the prune
 * that 003 lessons defect 5 met 60 s after a start. Run as
 * `node --import tsx pruning-daemon.ts <root>`; stops on SIGTERM.
 */
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { ownSignals } from "../../src/core/daemon/signals.js";

const root = process.argv[2];
if (root === undefined) throw new Error("usage: pruning-daemon.ts <root>");
const log = (line: string) => process.stderr.write(`pruning daemon: ${line}\n`);
let stop = () => {};
ownSignals(() => stop());
const daemon = await startDaemon({ root, log, ownsProcess: true, timings: { firstPruneMs: 0 } });
if ("reason" in daemon) {
  log(daemon.message);
  process.exit(daemon.code);
}
stop = () => void daemon.stop("signal");
const exit = await daemon.exited;
log(exit.message);
process.exit(exit.code);
