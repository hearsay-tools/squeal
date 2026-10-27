import { acquireLock } from "../../../../src/harness/codex/runtime-update/lock.js";

// A real process holds the transaction until released or killed by its test.
const data = process.argv[2];
if (data === undefined) throw new Error("lock-owner needs a data directory");
const attempt = await acquireLock(data);
if ("busy" in attempt) {
  process.send?.({ kind: "busy", pid: attempt.busy.pid });
  process.disconnect();
} else {
  process.on("message", (message) => {
    if (message !== "release") return;
    attempt.lock.release();
    process.disconnect();
  });
  process.send?.({ kind: "held", pid: process.pid });
}
