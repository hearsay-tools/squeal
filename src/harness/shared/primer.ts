import {
  formatRegistration,
  MESSAGE_CAP_CHARS,
  SQUEAL_COMMAND,
} from "../../core/delivery/index.js";
import { excludedProjectsText } from "../../core/text.js";
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

/**
 * Spec 005 D6, the human's wording (2026-10-10): revisions defined once, here,
 * since every result and `squeal why`'s `Changed since revision N:` line
 * (001-225) name one and agents guessed at what a jump meant.
 */
export const REVISION =
  "A revision is Squeal's number for each saved change to this worktree's files; every result names the revision it ran at, and a header names the files its revision changed.";

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
 * node:test and pytest project with its globs (spec 007 D8), and the slow files as a count, then says
 * typecheck, build and any other test suite are not, so the agent can work
 * out what is left to run (005's pilot: every false "pass" came from an
 * uncovered node:test suite).
 *
 * With slow files declared (spec 004 D8, D9) it says what the policy
 * requires of them before the agent finishes, with the header line that
 * says they are current and `run --slow --wait`, and when a slow failure
 * arrives. Codex names the CLI by its path, never `squeal`, and has no idle
 * wake (002): there a slow failure arrives with the next prompt or tool call. Task 001-283 (`research/primer-skill-writing.md`):
 * the arrival of results is said once, and the slow step sits beside the
 * wait it extends. Spec 005 D6: that sentence says passing results are
 * silent and a message means a check changed (an agent with only the primer
 * took silence for lost messages), and the primer defines a revision once.
 */
export function primer(command: string = SQUEAL_COMMAND, coverage: Coverage = VITEST_ONLY): string {
  const names = runnerNames(coverage);
  const sentences = (covers: string, naming: Naming, paths: boolean) =>
    [
      `${PRIMER_OPENING}${listed(names, "and")} tests in the background after each edit; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working; do not run ${listed(names, "or")} to learn whether your edits broke something.`,
      waitSentence(command, naming, paths),
      ...(coverage.slow === null
        ? []
        : slowSentences(command, naming, coverage.slow.requireSlowSuite === true)),
      "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
      retrySentence(command, naming),
      REVISION,
      covers,
      "Squeal does not cover typecheck, build or any other test suite: run those yourself.",
    ].join(" ");
  // Fold the node:test and pytest projects first, then name the CLI less, until the primer fits;
  // the path wait joins only where it fits without folding more (task 005-68).
  let text = "";
  const most = Math.max(coverage.nodeTest.length, coverage.pytest?.length ?? 0);
  for (const naming of ["every", "first", "none"] as const) {
    for (let node = most; node >= 0; node--) {
      text = sentences(coversSentence(coverage, node), naming, false);
      if (text.length > PRIMER_CAP_CHARS) continue;
      const paths = sentences(coversSentence(coverage, node), naming, true);
      return paths.length <= PRIMER_CAP_CHARS ? paths : text;
    }
  }
  return text;
}

/**
 * Spec 005 D6 as amended by the human (2026-10-17, task 005-68, issue 18):
 * which wait applies when. A path wait for the files just changed, with its
 * verdict line; the pathless wait and `run --all --wait` before saying the
 * task is done. An agent that knew only the pathless wait reported waiting
 * on most of a suite other work had re-keyed. What a path selects (005-67) is the
 * skill's: the primer is at its cap. Where it does not fit, `paths` off
 * gives the sentence it replaced, so no primer says less than before it,
 * projects and the CLI's naming included (the 005 coordinator, 2026-10-17).
 */
function waitSentence(command: string, naming: Naming, paths: boolean): string {
  if (!paths) {
    const wait =
      naming === "none"
        ? "`status --wait 60000` on the CLI SQUEAL messages name"
        : `\`${command} status --wait 60000\``;
    return `Wait only when you need a result before your next step, for example before saying the task is done: ${wait}.`;
  }
  // A Codex CLI is a long path: named in full once, as the path wait; unnamed, said once, up front.
  const full = naming === "every" && command === SQUEAL_COMMAND;
  const cli = (sub: string, first: boolean) =>
    naming !== "none" && (first || full)
      ? `\`${command} ${sub}\``
      : naming === "none"
        ? `\`${sub}\``
        : `the CLI's \`${sub}\``;
  return `Wait only when you need a result before your next step${naming === "none" ? ", on the CLI SQUEAL messages name" : ""}: ${cli("status --wait 60000 <path>...", true)} for the verdict on files you just changed; before you finish, ${cli("status --wait 60000", false)} or a checkpoint, ${cli("run --all --wait", false)}.`;
}

/**
 * Spec 001 D6 as amended (001-348, 001-368): when to ask for a retry, and the
 * one use it never has. Squeal cannot tell a failure caused outside the code
 * from a real one, so the agent asks, once per file at its inputs.
 */
function retrySentence(command: string, naming: Naming): string {
  // A Codex CLI is a long path: named in full only where it is `squeal`, so the primer keeps its naming.
  const cli =
    naming === "every" && command === SQUEAL_COMMAND ? `\`${command} retry` : "the CLI's `retry";
  return `For a failure from load or a stopped service: ${cli} <file> --reason load|environment\`, never past a real one.`;
}

/** The runners the daemon builds: Vitest when detected or when nothing else is configured (spec 003 D7). */
function runnerNames(coverage: Coverage): string[] {
  const nodeTest = coverage.nodeTest.length > 0;
  const pytest = (coverage.pytest?.length ?? 0) > 0;
  return [
    ...(coverage.vitest || (!nodeTest && !pytest) ? ["Vitest"] : []),
    ...(nodeTest ? ["node:test"] : []),
    ...(pytest ? ["pytest"] : []),
  ];
}

/** `words` as "a and b", or "a, b and c" past two (spec 007 D8: the third runner). */
function listed(words: readonly string[], conjunction: "and" | "or"): string {
  if (words.length <= 2) return words.join(` ${conjunction} `);
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}

/** What Squeal covers, naming the first `node` node:test and pytest projects of each runner. */
function coversSentence(coverage: Coverage, node: number): string {
  const suites = runnerNames(coverage).includes("Vitest")
    ? [
        `${coverage.vitestConfig === null ? "Vitest" : `Vitest (${coverage.vitestConfig})`}${excluded(coverage)}`,
      ]
    : [];
  if (coverage.nodeTest.length > 0) {
    const entries = coverage.nodeTest.map(
      ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`,
    );
    const list = named("project", entries, node);
    suites.push(node === 0 ? `node:test (${list})` : `node:test ${list}`);
  }
  if (coverage.pytest !== undefined && coverage.pytest.length > 0) {
    const entries = coverage.pytest.map(
      ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`,
    );
    const list = named("project", entries, node);
    suites.push(node === 0 ? `pytest (${list})` : `pytest ${list}`);
  }
  const files = coverage.slow?.files;
  const slow =
    coverage.slow === null
      ? ""
      : files === null || files === undefined
        ? ", with slow test files not counted yet"
        : `, with ${files} slow test ${files === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${listed(suites, "and")}${slow}.`;
}

/**
 * Task 001-349: the Vitest projects `vitest.excludeProjects` lists, as not
 * run, so the agent runs them itself when its change needs them.
 */
function excluded(coverage: Coverage): string {
  const entries = coverage.vitestExcluded ?? [];
  if (entries.length === 0) return "";
  const { text, plural } = excludedProjectsText(entries);
  return `; its ${text} ${plural ? "are" : "is"} not run, excluded by squeal.config.json`;
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
 * Spec 004 D8, D9: when slow files run, what this repository's "done"
 * requires of them, and how a slow failure arrives, by harness. D8 as
 * amended 2026-10-16 (task 004-62, issue #5): with `stop.requireSlowSuite`
 * on, task 001-283's step before a claim, read off the `Slow tier:` line,
 * and that Stop waits or holds once, as that line says (001-285; Pi and
 * OpenCode have no waiting entry, so their Stop holds; review wave-7 B1); off, the slow tier is not required before the
 * agent finishes, and a claim that slow tests pass needs that line current.
 * Each within 280 characters under `squeal`, which the longest Claude Code
 * primer of the coverage matrix keeps with every project named.
 */
function slowSentences(command: string, naming: Naming, required: boolean): string[] {
  const run =
    naming === "every"
      ? `\`${command} run --slow --wait 60000\``
      : "the CLI's `run --slow --wait 60000`";
  return [
    required
      ? `Slow test files run when you pause between turns; this repository requires them before you finish: before you say the task is done, run ${run} unless the latest \`Slow tier:\` line states every slow file is current; Stop waits for them or holds you once.`
      : `Slow test files run when you pause between turns; this repository does not require them before you finish: say slow tests pass only when the latest \`Slow tier:\` line states every slow file is current, else say how many are not; ${run} runs them now.`,
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
