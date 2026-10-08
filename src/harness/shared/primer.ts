import { readPolicy } from "../../core/daemon/policy.js";
import {
  formatRegistration,
  MESSAGE_CAP_CHARS,
  SQUEAL_COMMAND,
} from "../../core/delivery/index.js";
import { slowPolicyView } from "../../core/state/index.js";
import type { Registration } from "../../core/types/index.js";

/**
 * How to work with Squeal, decided by the human (task 001-88). The one
 * prohibition D6's factual wording allows, paired with what to do instead.
 * `command` is how it names the CLI (spec 002 D1 as amended). `nodeTest`
 * names node:test beside Vitest, for a policy with `nodeTest` projects
 * (spec 003 lessons, defect 1: told "Vitest", agents ran node:test themselves).
 *
 * `slow`, for a policy that declares slow files (spec 004 D8, D9): the slow
 * suites are covered, so the primer no longer says other suites are not, and
 * says when they run and when a slow failure arrives. Codex names the CLI
 * by its path, never `squeal`, and has no idle wake (002): there a slow
 * failure arrives with the next prompt or tool call.
 */
export function primer(command: string = SQUEAL_COMMAND, nodeTest = false, slow = false): string {
  const runners = nodeTest ? "Vitest and node:test" : "Vitest";
  const run = nodeTest ? "Vitest or node:test" : "Vitest";
  return [
    `Squeal runs this repository's ${runners} tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run ${run} to learn whether your edits broke something.`,
    `Results arrive with your next tool call, so keep working; wait only when you need a result before your next step, for example before saying the task is done: \`${command} status --wait 60000\`.`,
    "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
    ...(slow ? [slowSentence(command)] : []),
    slow
      ? "Squeal does not cover typecheck or build."
      : "Squeal does not cover typecheck, build or other test suites.",
  ].join(" ");
}

/** Spec 004 D8, D9: when slow suites run and how their failures arrive, by harness. */
function slowSentence(command: string): string {
  const arrives =
    command === SQUEAL_COMMAND
      ? "a slow failure wakes you when you are idle in an interactive session, otherwise it arrives with your next prompt or tool call"
      : "a slow failure arrives with your next prompt or tool call";
  return `Slow test suites run when you pause between turns or on \`${command} run --slow\`, never during Stop's wait; the header's slow-tier line says whether they are current, and ${arrives}.`;
}

/** Every primer `primer` can say with `command`: what a hook's cut keeps whole. */
export function primerVariants(command: string = SQUEAL_COMMAND): string[] {
  return [false, true].flatMap((nodeTest) =>
    [false, true].map((slow) => primer(command, nodeTest, slow)),
  );
}

/** The primer as the Claude Code plugin says it, with `squeal` on PATH, for a Vitest-only policy. */
export const PRIMER = primer();

/** Whether the policy at `root` configures `nodeTest` projects, so the primer names node:test. */
export function coversNodeTest(root: string): boolean {
  return readPolicy(root).nodeTest.length > 0;
}

/** Whether the policy at `root` declares slow files (spec 004 D1), so the primer names slow suites. */
export function coversSlowSuites(root: string): boolean {
  return slowPolicyView(readPolicy(root)) !== null;
}

/**
 * A registration with the primer after it, within the message cap. Task
 * 001-88: every registration that starts a session's use of Squeal carries it.
 */
export function withPrimer(
  registration: Registration,
  command: string = SQUEAL_COMMAND,
  nodeTest = false,
  slow = false,
): string {
  const tail = primer(command, nodeTest, slow);
  // Room the registration leaves for the primer within the message cap.
  const max = MESSAGE_CAP_CHARS - tail.length - 2;
  return `${formatRegistration(registration, max, command)}\n\n${tail}`;
}
