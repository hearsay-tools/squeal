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
 * With slow files declared (spec 004 D8, D9) it names the step before a
 * claim, `run --slow --wait`, with the header line that says it is done, and
 * when a slow failure arrives. Codex names the CLI by its path, never
 * `squeal`, and has no idle wake (002): there a slow failure arrives with the
 * next prompt or tool call. Task 001-283 (`research/primer-skill-writing.md`):
 * the arrival of results is said once, and the slow step sits beside the
 * wait it extends.
 */
export function primer(command: string = SQUEAL_COMMAND, coverage: Coverage = VITEST_ONLY): string {
  const names = runnerNames(coverage);
  const sentences = (covers: string, naming: Naming) =>
    [
      `${PRIMER_OPENING}${names.join(" and ")} tests in the background after each edit, and its results arrive as SQUEAL messages with your next tool call, so keep working; do not run ${names.join(" or ")} to learn whether your edits broke something.`,
      `Wait only when you need a result before your next step, for example before saying the task is done: ${
        naming === "none"
          ? "`status --wait 60000` on the CLI SQUEAL messages name"
          : `\`${command} status --wait 60000\``
      }.`,
      ...(coverage.slow === null ? [] : slowSentences(command, naming)),
      "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
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

/**
 * Spec 004 D8, D9: when slow files run, the step before a claim with its
 * completion criterion read off the `Slow tier:` line (task 001-283; it
 * holds for them since 001-282), and how a slow failure arrives, by harness.
 */
function slowSentences(command: string, naming: Naming): string[] {
  const run =
    naming === "every"
      ? `\`${command} run --slow --wait 60000\``
      : "the CLI's `run --slow --wait 60000`";
  return [
    `Slow test files run when you pause between turns; before you say the task is done, run ${run} unless the header's \`Slow tier:\` line already says every slow file is current: it runs the rest and waits for their results.`,
    command === SQUEAL_COMMAND
      ? "A slow failure wakes you when you are idle in an interactive session; otherwise it arrives with your next prompt or tool call."
      : "A slow failure arrives with your next prompt or tool call.",
  ];
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

/**
 * What Squeal is, said before anything else Squeal tells a session (experiment
 * for 001-292: the a5-uncovered false passes read counts before knowing whose
 * they were). It names no runner: the primer after it names the ones the
 * daemon builds here.
 */
export const INTRO =
  "This repository has Squeal installed, a background test runner: a daemon watches this worktree and, after each edit, re-runs the tests the edit can affect. It reports to you in SQUEAL messages like this one.";

/** How the registration's test state is introduced after the primer. */
export const STATE_LABEL = "Test state when this session started:";

/** The intro and the primer, as a session hears them with no state after (after `compact`). */
export function introducedPrimer(
  command: string = SQUEAL_COMMAND,
  coverage: Coverage = VITEST_ONLY,
): string {
  return `${INTRO}\n\n${primer(command, coverage)}`;
}

/** The primer as the Claude Code plugin says it, with `squeal` on PATH, for a Vitest-only policy. */
export const PRIMER = primer();

/**
 * A registration with the intro and the primer before it, within the message
 * cap. Task 001-88: every registration that starts a session's use of Squeal
 * carries the primer. Experiment for 001-292: what Squeal is and what it runs
 * come first, then the test state under its label, so a cut at the end trims
 * failures, never the primer.
 */
export function withPrimer(
  registration: Registration,
  command: string = SQUEAL_COMMAND,
  coverage: Coverage = VITEST_ONLY,
): string {
  const head = `${introducedPrimer(command, coverage)}\n\n${STATE_LABEL}\n`;
  // Room the intro and the primer leave for the registration within the message cap.
  const max = MESSAGE_CAP_CHARS - head.length;
  return `${head}${formatRegistration(registration, max, command)}`;
}
