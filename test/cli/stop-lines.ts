/*
 * Row 011-254 (the coordinator, 2026-10-26): `squeal stop`'s two success
 * lines, as a plain stop and as a stop until `squeal start` print them.
 */

const PLAIN = "; `squeal stop --until-start` keeps it stopped through edits and Git operations\n";
const UNTIL_START =
  "; it stays stopped until `squeal start`: no edit or Git operation starts one\n";

/** The line of a stop that stopped the daemon of `root`. */
export function stoppedLine(root: string, untilStart = false): string {
  return `Squeal daemon stopped for ${root}${untilStart ? UNTIL_START : PLAIN}`;
}

/** The line of a stop that found no daemon for `root`. */
export function noDaemonLine(root: string, untilStart = false): string {
  return `No daemon running for ${root}${untilStart ? UNTIL_START : PLAIN}`;
}
