import { acquireLock } from "../../../../src/harness/codex/runtime-update/lock.js";

// A real process holds the transaction until released or killed by its test.
// Without an IPC channel (a synchronous spawn) it attempts once, prints its
// result and keeps nothing (row 011-279).
const data = process.argv[2];
if (data === undefined) throw new Error("lock-owner needs a data directory");
const attempt = await acquireLock(data);
const result =
  "busy" in attempt ? { kind: "busy", pid: attempt.busy.pid } : { kind: "held", pid: process.pid };
if (process.send === undefined) {
  if ("lock" in attempt) attempt.lock.release();
  console.log(JSON.stringify(result));
} else if ("busy" in attempt) {
  process.send(result);
  process.disconnect();
} else {
  process.on("message", (message) => {
    if (message !== "release") return;
    attempt.lock.release();
    process.disconnect();
  });
  process.send(result);
}
