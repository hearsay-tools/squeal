// Throwaway probe (see README.md): polls the waiter lock state like the Pi wake tests do.
import { setTimeout as sleep } from "node:timers/promises";
import { waiterLockState } from "../../../../../../src/core/waiter-lock/waiter-lock.js";

const [locksDir = "", intervalText = "20"] = process.argv.slice(2);
const interval = Number(intervalText);
const consumer = { worktreeId: "w", sessionId: "s", agentId: "main" } as never;
const counts = { absent: 0, held: 0, free: 0 };
process.on("message", () => {
  process.send?.(counts, () => process.exit(0));
});
for (;;) {
  counts[waiterLockState(locksDir as never, consumer)]++;
  await sleep(interval);
}
