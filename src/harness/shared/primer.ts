import {
  formatRegistration,
  MESSAGE_CAP_CHARS,
  SQUEAL_COMMAND,
} from "../../core/delivery/format.js";
import type { Registration } from "../../core/types/delivery.js";
import { PRIMER_FIRST, PRIMER_FORMS, type PrimerForm, UNNAMED_CLI } from "./primer-forms.js";

/**
 * The longest primer: a CLI whose name would take it past this length is
 * named fewer times, then not at all (review wave 13aa, B3: a Codex CLI's
 * path may be thousands of characters). Codex keeps a trailing primer of at
 * most this length whole when it cuts a hook's text (`trailingPrimer`).
 */
export const PRIMER_CAP_CHARS = 1_500;

/** How every primer starts, so a hook's cut can find one at the end of a text. */
export const PRIMER_OPENING = "Squeal runs this repository's ";

/** `primer`'s choices beyond the CLI's name. */
export interface PrimerOptions {
  /**
   * Whether the harness ships the squeal skill, which the start message
   * sends the agent to (`HookDeps.skill`). Default `true`; OpenCode ships
   * none, so its start message says the skill's rules itself.
   */
  readonly skill?: boolean | undefined;
}

/** Where the primer names the CLI: in every command, in the first only, or nowhere. */
type Naming = "every" | "first" | "none";

/**
 * Spec 005 D6 as amended 2026-11-19 (row 005-128, the human: "Yes, ship all
 * of it"; `research/start-message-experiment.md`): the start message says
 * what Squeal does, sends the agent to the squeal skill and names `squeal
 * checks` and `squeal status`; the rules live in the skill, in `squeal
 * checks` and in the hook messages. A harness with no skill gets the rules
 * in words. The words are `primer-forms.ts`'.
 *
 * `command` is how it names the CLI (spec 002 D1 as amended): `squeal` in
 * every command; a Codex path in full in the first command and as "the
 * CLI's" after it; unnamed where that does not fit within the cap, with one
 * sentence that says whose commands they are.
 */
export function primer(command: string = SQUEAL_COMMAND, options: PrimerOptions = {}): string {
  const form: PrimerForm = (options.skill ?? true) ? "skill" : "no-skill";
  const render = (naming: Naming): string => {
    let named = false;
    const cli = (sub: string): string => {
      if (naming === "none") return `\`${sub}\``;
      const full = naming === "every" || !named;
      named = true;
      return full ? `\`${command} ${sub}\`` : `the CLI's \`${sub}\``;
    };
    const Cli = (sub: string): string => {
      const text = cli(sub);
      return text.startsWith("the ") ? `T${text.slice(1)}` : text;
    };
    return [
      `${PRIMER_OPENING}${PRIMER_FIRST}`,
      ...PRIMER_FORMS[form]({ cli, Cli }),
      ...(naming === "none" ? [UNNAMED_CLI] : []),
    ].join(" ");
  };
  const namings: Naming[] = command === SQUEAL_COMMAND ? ["every"] : ["first", "none"];
  let text = "";
  for (const naming of namings) {
    text = render(naming);
    if (text.length <= PRIMER_CAP_CHARS) return text;
  }
  return text;
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

/** The primer as the Claude Code plugin says it, with `squeal` on PATH. */
export const PRIMER = primer();

/**
 * A registration with the primer after it, within the message cap. Task
 * 001-88: every registration that starts a session's use of Squeal carries it.
 */
export function withPrimer(
  registration: Registration,
  command: string = SQUEAL_COMMAND,
  options: PrimerOptions = {},
): string {
  const tail = primer(command, options);
  // Room the registration leaves for the primer within the message cap.
  const max = MESSAGE_CAP_CHARS - tail.length - 2;
  return `${formatRegistration(registration, max, command)}\n\n${tail}`;
}
