// Row 011-294: the lock-file marks are daemon presence's (`presence/lock-events.ts` writes them).
export { clearStartMark, markSpawn, markStart } from "../presence/lock-events.js";
export {
  type DaemonStart,
  daemonStart,
  spawnMarkFor,
  startMarked,
  startMarkFor,
} from "../presence/marks.js";
