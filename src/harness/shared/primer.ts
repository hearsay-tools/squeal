import {
  formatRegistration,
  MESSAGE_CAP_CHARS,
  SQUEAL_COMMAND,
} from "../../core/delivery/format.js";
import { holdsText } from "../../core/state/slow-text.js";
import { excludedProjectsText } from "../../core/text.js";
import type { CheckMoment } from "../../core/types/check-groups.js";
import type { Registration } from "../../core/types/delivery.js";
import {
  type Covered,
  type CoveredProject,
  DESCRIPTIONS,
  type RunnerDescription,
} from "../../runners/descriptions.js";
import { type Coverage, DEFAULT_COVERAGE, type GroupsCoverage } from "./coverage.js";

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
 * Which wait sentence the primer says: the path wait (005-68), the sentence
 * it replaced, or that sentence without its example, which names the CLI at
 * the wait where the others no longer fit (task 004-78).
 */
type WaitForm = "paths" | "plain" | "short";

/**
 * How to work with Squeal, decided by the human (task 001-88). The one
 * prohibition D6's factual wording allows, paired with what to do instead.
 * `command` is how it names the CLI (spec 002 D1 as amended). It names the
 * runners the daemon builds (spec 003 lessons, defect 1: agents told of one
 * runner ran another's tests themselves; review wave 13aa, B1: a repository
 * is never told of a runner the daemon does not build there).
 *
 * Task 001-234: it lists what Squeal covers, each runner's config or its
 * projects with their globs (spec 007 D8), and the slow files as a count,
 * then says typecheck, build and any other test suite are not, so the agent
 * can work out what is left to run (005's pilot: every false "pass" came
 * from an uncovered suite). What it says of a runner is that runner's
 * description (spec 016 D5).
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
export function primer(
  command: string = SQUEAL_COMMAND,
  coverage: Coverage = DEFAULT_COVERAGE,
): string {
  const names = runnersOf(coverage).map((runner) => runner.name);
  const groups = coverage.groups;
  // Spec 019 D6 (row 019-16): with check groups, the moments sentence says when each runs.
  const when = groups === undefined ? " after each edit" : "";
  // Row 019-49 (D6): with no test group at `edit`, silence between edits is not a pass.
  const quiet = groups?.noTestsAtEdit === true;
  // Review 0.1.411, B1: where D6's clause leaves no rendering within the cap, the same folds
  // run again with a compact clause that keeps the warning and is shorter than the edit one.
  const arrivals = quiet
    ? [
        ", but no test group runs after each edit, so silence between edits is not a pass; a SQUEAL message with your next tool call means a check changed;",
        ", but not after each edit, so silence between edits is not a pass; a SQUEAL message means a check changed;",
      ]
    : [
        `${when}; a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working;`,
      ];
  const most = Math.max(
    0,
    ...DESCRIPTIONS.map((runner) => projectsOf(runner.covered(coverage))?.length ?? 0),
  );
  let text = "";
  for (const arrival of arrivals) {
    const sentences = (covers: string, naming: Naming, wait: WaitForm) =>
      [
        `${PRIMER_OPENING}${listed(names, "and")} tests in the background${arrival} do not run ${listed(names, "or")} to learn whether your edits broke something.`,
        ...(groups === undefined ? [] : [momentsSentence(command, naming, groups)]),
        waitSentence(command, naming, wait, quiet),
        ...(coverage.slow === null ? [] : slowSentences(command, naming, coverage.slow)),
        "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it.",
        retrySentence(command, naming),
        REVISION,
        covers,
        notCovered(coverage),
      ].join(" ");
    text = folded(sentences, coverage, most);
    if (text.length <= PRIMER_CAP_CHARS) return text;
  }
  return text;
}

/**
 * Fold the runners' projects first, then name the CLI less, until the primer fits;
 * the path wait joins only where it fits without folding more (task 005-68). Before the
 * CLI goes unnamed, the wait sentence drops its example, so a long CLI is still named at
 * the wait (task 004-78: a 217-character Codex CLI went unnamed and agents ran a bare wait).
 * Over the cap at every fold, the last one tried.
 */
function folded(
  sentences: (covers: string, naming: Naming, wait: WaitForm) => string,
  coverage: Coverage,
  most: number,
): string {
  let text = "";
  for (const naming of ["every", "first", "none"] as const) {
    for (let node = most; node >= 0; node--) {
      text = sentences(coversSentence(coverage, node), naming, "plain");
      if (text.length > PRIMER_CAP_CHARS) continue;
      const paths = sentences(coversSentence(coverage, node), naming, "paths");
      return paths.length <= PRIMER_CAP_CHARS ? paths : text;
    }
    if (naming !== "first") continue;
    for (let node = most; node >= 0; node--) {
      text = sentences(coversSentence(coverage, node), naming, "short");
      if (text.length <= PRIMER_CAP_CHARS) return text;
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
 * `short` is that sentence in fewer words, for a CLI too long for it, so the
 * CLI stays named at the wait (task 004-78). Row 019-49 (019 D6): with no
 * test group at `edit` (`quiet`), the path wait becomes the narrow run, since
 * a path wait does not start a file its group's moment holds.
 */
function waitSentence(command: string, naming: Naming, form: WaitForm, quiet = false): string {
  if (form === "short") {
    return `Wait only when you need a result, as before you finish: \`${command} status --wait 60000\`.`;
  }
  if (form === "plain") {
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
  const on = naming === "none" ? ", on the CLI SQUEAL messages name" : "";
  const finish = `before you finish, ${cli("status --wait 60000", false)} or a checkpoint, ${cli("run --all --wait", false)}.`;
  // Row 019-49 (D6): with no test group at `edit`, the path wait is the narrow run.
  if (quiet) {
    return `Before you rely on a result for files you changed${on}: ${cli("run <group> <path>... --wait 60000", true)}; ${finish}`;
  }
  return `Wait only when you need a result before your next step${on}: ${cli("status --wait 60000 <path>...", true)} for the verdict on files you just changed; ${finish}`;
}

/** D6's words for a moment, as the agent meets it; a `manual` group's clause names its run instead. */
const AT: Readonly<Record<Exclude<CheckMoment, "manual">, string>> = {
  edit: "after each edit",
  pause: "between your turns",
  stop: "at Stop, and Stop waits for them",
  commit: "when you commit",
};

/**
 * Spec 019 D6 (row 019-16): one clause per moment that has groups, naming
 * them, then the command that runs one group now (D6 "Command"). The
 * default `tests` group is said with what it holds, once: its name is the
 * one status and `after` use. For example: `Check groups: unit and tests
 * (the test files no group selects) after each edit; e2e at Stop, and Stop
 * waits for them; lint when you commit; parity waits for `squeal run
 * parity`; `squeal run <group> --wait 60000` runs one now.`
 */
function momentsSentence(command: string, naming: Naming, groups: GroupsCoverage): string {
  // A Codex CLI is a long path: named in full only where it is `squeal`, as the retry sentence does.
  const cli = (sub: string) =>
    naming === "every" && command === SQUEAL_COMMAND
      ? `\`${command} ${sub}\``
      : `the CLI's \`${sub}\``;
  const clauses = groups.moments.map(({ at, names }) => {
    const named = listed(
      names.map((name) => (name === "tests" ? "tests (the test files no group selects)" : name)),
      "and",
    );
    if (at !== "manual") return `${named} ${AT[at]}`;
    // Row 019-47: nothing but its run starts a `manual` group.
    const one = names.length === 1;
    return `${named} ${one ? "waits" : "wait"} for ${cli(`run ${one ? names[0] : "<group>"}`)}`;
  });
  return `Check groups: ${clauses.join("; ")}; ${cli("run <group> --wait 60000")} runs one now.`;
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

/** The runners the daemon builds: each one built, and the fallback when no other is (spec 003 D7). */
function runnersOf(coverage: Coverage): RunnerDescription[] {
  const others = DESCRIPTIONS.some((runner) => !runner.fallback && runner.built(coverage));
  return DESCRIPTIONS.filter((runner) => runner.built(coverage) || (runner.fallback && !others));
}

/** The projects a runner's entry lists, or `null` for an entry named by its config. */
function projectsOf(covered: Covered): readonly CoveredProject[] | null {
  return "projects" in covered ? covered.projects : null;
}

/** `words` as "a and b", or "a, b and c" past two (spec 007 D8: the third runner). */
function listed(words: readonly string[], conjunction: "and" | "or"): string {
  if (words.length <= 2) return words.join(` ${conjunction} `);
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}

/** What Squeal covers, naming the first `node` projects of each runner that lists projects. */
function coversSentence(coverage: Coverage, node: number): string {
  const suites = runnersOf(coverage).map((runner) =>
    suite(runner.name, runner.covered(coverage), node),
  );
  const files = coverage.slow?.files;
  const slow =
    coverage.slow === null
      ? ""
      : files === null || files === undefined
        ? ", with slow test files not counted yet"
        : `, with ${files} slow test ${files === 1 ? "file" : "files"} at the daemon's last listing`;
  return `Squeal covers ${listed(suites, "and")}${slow}.`;
}

/** A runner's entry: its name with its config, or with its first `shown` projects. */
function suite(runner: string, covered: Covered, shown: number): string {
  if (!("projects" in covered)) {
    const config = covered.config === null ? runner : `${runner} (${covered.config})`;
    return `${config}${excluded(covered.excludedProjects)}`;
  }
  const entries = covered.projects.map(
    ({ name, include }) => `${JSON.stringify(name)} (${include.join(", ")})`,
  );
  const list = named("project", entries, shown);
  return shown === 0 ? `${runner} (${list})` : `${runner} ${list}`;
}

/**
 * Task 001-349: the projects of a runner that squeal.config.json excludes,
 * as not run, so the agent runs them itself when its change needs them.
 */
function excluded(entries: readonly string[]): string {
  if (entries.length === 0) return "";
  const { text, plural } = excludedProjectsText(entries);
  return `; its ${text} ${plural ? "are" : "is"} not run, excluded by squeal.config.json`;
}

/**
 * Task 001-234: what Squeal does not cover, always whole; spec 004 D8 as
 * amended 2026-10-18 (task 004-81): with the test files each runner's
 * excludes drop named, as its description names them.
 */
function notCovered(coverage: Coverage): string {
  const files = DESCRIPTIONS.flatMap((runner) => runner.excluded(coverage) ?? []);
  const what =
    files.length === 0
      ? "typecheck, build"
      : `typecheck, build, the ${files.join(", the ")}, which squeal.config.json excludes,`;
  return `Squeal does not cover ${what} or any other test suite: run those yourself.`;
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
 * and that Stop waits or holds once (or up to `stop.maxHolds` times in a
 * turn, row 019-24), as that line says (001-285; Pi and
 * OpenCode have no waiting entry, so their Stop holds; review wave-7 B1); off, the slow tier is not required before the
 * agent finishes, and a claim that slow tests pass needs that line current.
 * Task 004-67 (issue 19): on, the requirement starts once the agent changes
 * a file, since Stop holds no main agent whose worktree had no revision
 * since it registered; no longer than the sentence it replaced, so no
 * primer folds more.
 * Row 004-80 (D8 as amended 2026-10-18): slow files run after the fast
 * tests under `slow.trigger: "continuous"`, when the agent pauses under
 * `"idle"` (`pausesOnly`).
 * Row 004-83 (D8 as amended 2026-10-19): under both policies `run --slow
 * --wait` is named as the wait for the slow files' results, which joins a
 * file already running; "runs them now" read as a second run.
 * Each within 280 characters under `squeal`, which the longest Claude Code
 * primer of the coverage matrix keeps with every project named.
 */
function slowSentences(
  command: string,
  naming: Naming,
  slow: NonNullable<Coverage["slow"]>,
): string[] {
  const run =
    naming === "every"
      ? `\`${command} run --slow --wait 60000\``
      : "the CLI's `run --slow --wait 60000`";
  const when = slow.pausesOnly === true ? "between your turns" : "after the fast tests";
  return [
    slow.requireSlowSuite === true
      ? `Slow test files run ${when}; this repository requires them once you change a file: before you say the task is done, wait with ${run} unless the latest \`Slow tier:\` line says every slow file is current; Stop waits or holds you ${holdsText(slow.maxHolds)}.`
      : `Slow test files run ${when}; this repository does not require them before you finish: say slow tests pass only when the latest \`Slow tier:\` line states every slow file is current, else say how many are not, or wait for them with ${run}.`,
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

/** The primer as the Claude Code plugin says it, with `squeal` on PATH, for the default coverage. */
export const PRIMER = primer();

/**
 * A registration with the primer after it, within the message cap. Task
 * 001-88: every registration that starts a session's use of Squeal carries it.
 */
export function withPrimer(
  registration: Registration,
  command: string = SQUEAL_COMMAND,
  coverage: Coverage = DEFAULT_COVERAGE,
): string {
  const tail = primer(command, coverage);
  // Room the registration leaves for the primer within the message cap.
  const max = MESSAGE_CAP_CHARS - tail.length - 2;
  return `${formatRegistration(registration, max, command)}\n\n${tail}`;
}
