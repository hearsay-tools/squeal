// Test-only (row 011-126): loaded into a daemon with `node --import` through `NODE_OPTIONS`, it
// appends each hold of the daemon's main-thread event loop past 100 ms to the file
// `SQUEAL_TEST_STALLS` names, one `<start epoch ms> <ms>` line each. The daemon's worker threads
// and the processes it starts load it too, and do nothing.
import { appendFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";

const log = process.env.SQUEAL_TEST_STALLS;
if (log && isMainThread && process.argv[2] === "daemon") {
  // The file shows the test the monitor ran.
  appendFileSync(log, "");
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - last > 100) appendFileSync(log, `${last} ${now - last}\n`);
    last = now;
  }, 10).unref();
}
