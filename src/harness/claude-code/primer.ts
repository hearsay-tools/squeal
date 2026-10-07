import { formatRegistration, MESSAGE_CAP_CHARS } from "../../core/delivery/index.js";
import type { Registration } from "../../core/types/index.js";

/**
 * How to work with Squeal, decided by the human (task 001-88). The one
 * prohibition D6's factual wording allows, paired with what to do instead.
 */
export const PRIMER = [
  "Squeal runs this repository's Vitest tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run Vitest to learn whether your edits broke something.",
  "Results arrive with your next tool call, so keep working; wait only when you need a result before your next step, for example before saying the task is done: `squeal status --wait 60000`.",
  "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
  "Squeal does not cover typecheck, build or other test suites.",
].join(" ");

/** Room the registration leaves for the primer within the message cap. */
const REGISTRATION_MAX = MESSAGE_CAP_CHARS - PRIMER.length - 2;

/**
 * A registration with the primer after it, within the message cap. Task
 * 001-88: every registration that starts a session's use of Squeal carries it.
 */
export function withPrimer(registration: Registration): string {
  return `${formatRegistration(registration, REGISTRATION_MAX)}\n\n${PRIMER}`;
}
