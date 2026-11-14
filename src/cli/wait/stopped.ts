import { noDaemonText } from "../status-wait-lines.js";
import type { DaemonDown } from "./table.js";

/*
 * Row 011-327's stopped words for the run waits' lines, apart from the
 * reads in `presence.ts` (row 011-331), so the wait module's loops do not
 * import the status lines.
 */

/**
 * Row 011-327: why the wait view found the daemon down, in the status
 * waits' words (`noDaemonText`): a cleared record, "the daemon stopped"; a
 * dead socket past the heartbeat's grace; a handoff past its bound.
 */
export function stoppedText(daemon: DaemonDown, command: string): string {
  return noDaemonText(daemon.liveness, daemon.reason, command);
}
