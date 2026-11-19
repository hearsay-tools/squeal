/*
 * Row 005-128 (spec 005 D6 as amended 2026-11-19): the words of the start
 * message, approved by the human, each form a list of sentences after the
 * opening one. `cli(sub)` names a CLI command as `primer` names it
 * (`primer.ts`); `Cli(sub)` the same at the start of a sentence. A wording
 * change is an edit of a string here.
 */

/** How a form names a command: within a sentence, and opening one. */
export interface CliNames {
  readonly cli: (sub: string) => string;
  readonly Cli: (sub: string) => string;
}

/** `"skill"` for a harness that ships the squeal skill, `"no-skill"` for one that does not. */
export type PrimerForm = "skill" | "no-skill";

/** Every form's first sentence, after `PRIMER_OPENING`. */
export const PRIMER_FIRST =
  "checks in the background and tells you with your next tool call when one changes; a pass is silent.";

/** Each form's sentences after the first. */
export const FORM_TEXTS: Readonly<Record<PrimerForm, (names: CliNames) => readonly string[]>> = {
  // For a harness that ships the squeal skill (Claude Code, Codex, Pi).
  skill: ({ cli, Cli }) => [
    "Read the squeal skill before you run or judge tests: it says what to do instead of a hand run, and with a failure you did not cause.",
    `${Cli("checks")} lists this repository's checks and when each runs; ${cli("status")} gives the current results.`,
  ],
  // For a harness with no squeal skill (OpenCode): the skill's rules in words.
  "no-skill": ({ cli, Cli }) => [
    "Do not run the tests yourself to learn whether an edit broke something.",
    `A check that does not run after an edit: ${cli("run <check> --wait 60000")}.`,
    `A failure you did not cause, from load or a stopped service: ${cli("retry <file> --reason load|environment")}, then claim from that result.`,
    `Before you say you are done: ${cli("status --wait 60000")}.`,
    `${Cli("checks")} lists this repository's checks and when each runs.`,
  ],
};

/** The sentence a form ends with when the CLI is too long to name at all. */
export const UNNAMED_CLI = "These are commands of the CLI SQUEAL messages name.";
