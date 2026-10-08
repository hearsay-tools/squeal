import {
  formatRegistration,
  MESSAGE_CAP_CHARS,
  SQUEAL_COMMAND,
} from "../../core/delivery/index.js";
import type { Registration } from "../../core/types/index.js";

/**
 * How to work with Squeal, decided by the human (task 001-88). The one
 * prohibition D6's factual wording allows, paired with what to do instead.
 * `command` is how it names the CLI (spec 002 D1 as amended).
 */
export function primer(command: string = SQUEAL_COMMAND): string {
  return [
    "Squeal runs this repository's Vitest tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run Vitest to learn whether your edits broke something.",
    `Results arrive with your next tool call, so keep working; wait only when you need a result before your next step, for example before saying the task is done: \`${command} status --wait 60000\`.`,
    "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
    "Squeal does not cover typecheck, build or other test suites.",
  ].join(" ");
}

/** The primer as the Claude Code plugin says it, with `squeal` on PATH. */
export const PRIMER = primer();

/**
 * A registration with the primer after it, within the message cap. Task
 * 001-88: every registration that starts a session's use of Squeal carries it.
 */
export function withPrimer(registration: Registration, command: string = SQUEAL_COMMAND): string {
  const tail = primer(command);
  // Room the registration leaves for the primer within the message cap.
  const max = MESSAGE_CAP_CHARS - tail.length - 2;
  return `${formatRegistration(registration, max, command)}\n\n${tail}`;
}
