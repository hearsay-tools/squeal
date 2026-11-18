/*
 * Row 005-126 (wave 30, an experiment that does not ship): the words of the
 * short start messages, each a list of sentences after the opening one.
 * `cli(sub)` names a CLI command as the primer's naming rules give it
 * (`primer.ts`, `shortPrimer`); `Cli(sub)` the same at the start of a
 * sentence. A wording change is an edit of a string here.
 */

/** How a form names a command: within a sentence, and opening one. */
export interface CliNames {
  readonly cli: (sub: string) => string;
  readonly Cli: (sub: string) => string;
}

/** The short forms of `PrimerForm`; `"full"` is the shipped primer. */
export type ShortForm = "minimal" | "minimal-rules" | "skill" | "no-skill";

/** Every short form's first sentence, after `PRIMER_OPENING`. */
export const SHORT_OPENING =
  "checks in the background and tells you with your next tool call when one changes; a pass is silent.";

/** Each short form's sentences after the first. */
export const SHORT_FORMS: Readonly<Record<ShortForm, (names: CliNames) => readonly string[]>> = {
  // Form B.
  minimal: ({ cli, Cli }) => [
    `${Cli("checks")} lists the checks this repository defines and when each runs.`,
    `${Cli("status")} gives the current results, ${cli("run <check>")} runs one now, ${cli("retry <file>")} repeats a failure caused by load or a stopped service.`,
    `${Cli("--help")} has the rest.`,
  ],
  // Form C: B with two rules after its first sentence.
  "minimal-rules": (names) => [
    "Do not run the tests yourself to learn whether an edit broke something.",
    `Before you say you are done, ${names.cli("status --wait 60000")} gives the verdict.`,
    ...SHORT_FORMS.minimal(names),
  ],
  // For a harness that ships the squeal skill (Claude Code, Codex, Pi).
  skill: ({ cli, Cli }) => [
    "Read the squeal skill before you run or judge tests: it says what to do instead of a hand run, and with a failure you did not cause.",
    `${Cli("checks")} lists this repository's checks and when each runs; ${cli("status")} gives the current results.`,
  ],
  // The `"skill"` form for a harness with no squeal skill (OpenCode).
  "no-skill": ({ cli, Cli }) => [
    "Do not run the tests yourself to learn whether an edit broke something.",
    `A check that does not run after an edit: ${cli("run <check> --wait 60000")}.`,
    `A failure you did not cause, from load or a stopped service: ${cli("retry <file> --reason load|environment")}, then claim from that result.`,
    `Before you say you are done: ${cli("status --wait 60000")}.`,
    `${Cli("checks")} lists this repository's checks and when each runs.`,
  ],
};

/** The sentence a short form ends with when the CLI is too long to name at all. */
export const UNNAMED_CLI = "These are commands of the CLI SQUEAL messages name.";
