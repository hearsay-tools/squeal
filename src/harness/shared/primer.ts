import {
  formatRegistration,
  MESSAGE_CAP_CHARS,
  SQUEAL_COMMAND,
} from "../../core/delivery/index.js";
import type { Registration } from "../../core/types/index.js";
import { type Coverage, VITEST_ONLY } from "./coverage.js";

/**
 * The longest primer: the coverage list folds its projects into "and N more",
 * then the primer names the CLI fewer times, to stay within it, so the
 * sentence saying what is not covered is always whole (task 001-234; review
 * wave 13aa, B3: a Codex CLI's path may be thousands of characters). Codex
 * keeps a trailing primer of at most this length whole when it cuts a hook's
 * text.
 */
export const PRIMER_CAP_CHARS = 1_500;

/** How every primer starts, so a hook's cut can find one at the end of a text. */
export const PRIMER_OPENING = "Squeal runs this repository's ";

/** Where the primer names the CLI: in every command, in the first only, or nowhere. */
type Naming = "every" | "first" | "none";

/**
 * How to work with Squeal, decided by the human (task 001-88). The one
 * prohibition D6's factual wording allows, paired with what to do instead.
 * `command` is how it names the CLI (spec 002 D1 as amended). It names the
 * runners the daemon builds (spec 003 lessons, defect 1: told "Vitest",
 * agents ran node:test themselves; review wave 13aa, B1: a node:test-only
 * repository is never told Vitest is covered).
 *
 * Task 001-234: it lists what Squeal covers, the Vitest config, each
 * node:test project with its globs, and the slow files as a count, then says
 * typecheck, build and any other test suite are not, so the agent can work
 * out what is left to run (005's pilot: every false "pass" came from an
 * uncovered node:test suite).
 *
 * With slow files declared (spec 004 D8, D9) it says when they run and when
 * a slow failure arrives. Codex names the CLI by its path, never `squeal`,
 * and has no idle wake (002): there a slow failure arrives with the next
 * prompt or tool call.
 */
export function primer(command: string = SQUEAL_COMMAND, coverage: Coverage = VITEST_ONLY): string {
  const names = runnerNames(coverage);
  const sentences = (covers: string, naming: Naming) =>
    [
      `${PRIMER_OPENING}${names.join(" and ")} tests in the background after each edit, and its results arrive as SQUEAL messages after your tool calls; do not run ${names.join(" or ")} to learn whether your edits broke something.`,
      `Results arrive with your next tool call, so keep working; wait only when you need a result before your next step, for example before saying the task is done: ${
        naming === "none"
          ? "`status --wait 60000` on the CLI SQUEAL messages name"
          : `\`${command} status --wait 60000\``
      }.`,
      "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
      ...(coverage.slow === null ? [] : [slowSentence(command, naming)]),
      covers,
      "Squeal does not cover typecheck, build or any other test suite: run those yourself.",
    ].join(" ");
  // Fold the node:test projects first, then name the CLI less, until the primer fits.
  let text = "";
  for (const naming of ["every", "first", "none"] as const) {
    for (let node = coverage.nodeTest.length; node >= 0; node--) {
      text = sentences(coversSentence(coverage, node), naming);
      if (text.length <= PRIMER_CAP_CHARS) return text;
    }
  }
  return text;
}

/** The runners the daemon builds: Vitest when detected or when nothing else is configured (spec 003 D7). */
function runnerNames(coverage: Coverage): string[] {
  const nodeTest = coverage.nodeTest.length > 0;
  return [...(coverage.vitest || !nodeTest ? ["Vitest"] : []), ...(nodeTest ? ["node:test"] : [])];
}

/** What Squeal covers, naming the first `node` node:test projects. */
function coversSentence(coverage: Coverage, node: number): string {
  const suites = runnerNames(coverage).includes("Vitest")
    ? [coverage.vitestConfig === null ? "Vitest" : `Vitest (${coverage.vitestConfig})`]
    : [];
  if (coverage.nodeTest.length > 0) {
    const entries = coverage.nodeTest.map(
      ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`,
    );
    const list = named("project", entries, node);
    suites.push(node === 0 ? `node:test (${list})` : `node:test ${list}`);
  }
  const files = coverage.slow?.files;
  const slow =
    coverage.slow === null
      ? ""
      : files === null || files === undefined
        ? ", with slow test files not counted yet"
        : `, with ${files} slow test ${files === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${suites.join(" and ")}${slow}.`;
}

/** `entries` as "projects a, b and c", the first `shown` of them, the rest as "and N more". */
function named(noun: string, entries: readonly string[], shown: number): string {
  const nouns = entries.length === 1 ? noun : `${noun}s`;
  if (shown === 0) return `${entries.length} ${nouns}`;
  const listed = entries.slice(0, shown);
  const rest = entries.length - shown;
  const tail = rest > 0 ? [...listed, `${rest} more`] : listed;
  const last = tail.pop() as string;
  return `${nouns} ${tail.length === 0 ? last : `${tail.join(", ")} and ${last}`}`;
}

/** Spec 004 D8, D9: when slow suites run and how their failures arrive, by harness. */
function slowSentence(command: string, naming: Naming): string {
  const arrives =
    command === SQUEAL_COMMAND
      ? "a slow failure wakes you when you are idle in an interactive session, otherwise it arrives with your next prompt or tool call"
      : "a slow failure arrives with your next prompt or tool call";
  const run = naming === "every" ? `\`${command} run --slow\`` : "the CLI's `run --slow`";
  return `Slow test suites run when you pause between turns or on ${run}, never during Stop's wait; the header's slow-tier line says whether they are current, and ${arrives}.`;
}

/**
 * The primer at the end of `text`, after a blank line, or `""`: what a hook's
 * cut keeps whole. A primer is one paragraph within `PRIMER_CAP_CHARS`.
 */
export function trailingPrimer(text: string): string {
  const at = text.lastIndexOf(`\n\n${PRIMER_OPENING}`);
  if (at < 0) return "";
  const tail = text.slice(at);
  return tail.length - 2 <= PRIMER_CAP_CHARS && !tail.slice(2).includes("\n") ? tail : "";
}

/** The primer as the Claude Code plugin says it, with `squeal` on PATH, for a Vitest-only policy. */
export const PRIMER = primer();

/**
 * A registration with the primer after it, within the message cap. Task
 * 001-88: every registration that starts a session's use of Squeal carries it.
 */
export function withPrimer(
  registration: Registration,
  command: string = SQUEAL_COMMAND,
  coverage: Coverage = VITEST_ONLY,
): string {
  const tail = primer(command, coverage);
  // Room the registration leaves for the primer within the message cap.
  const max = MESSAGE_CAP_CHARS - tail.length - 2;
  return `${formatRegistration(registration, max, command)}\n\n${tail}`;
}
