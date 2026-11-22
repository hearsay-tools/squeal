import { MESSAGE_CAP_CHARS, SQUEAL_COMMAND } from "../../core/delivery/format.js";
import { trailingPrimer } from "../shared/primer.js";

/*
 * Antigravity hook output shapes (spec 024 D3): `injectSteps` with one
 * `systemMessage` for SessionStart and PreInvocation, `decision: "deny"` for
 * PreToolUse and `decision: "continue"` for Stop. Allow and silence are empty
 * stdout, never `{}`, which PreToolUse reads as a deny
 * (`research/antigravity-hooks-and-plugins.md` finding 2).
 */

/** Spec 024 D3: every text an Antigravity hook gives the model, the shared formats' cap. */
export { MESSAGE_CAP_CHARS };

const cutLine = (command: string) =>
  `SQUEAL · cut to fit an Antigravity hook; \`${command} status\` has the rest.`;

/**
 * `text` within `MESSAGE_CAP_CHARS`, as Codex's `capContext` holds its own
 * cap: a longer one is cut at a line boundary and says so; a trailing primer
 * (`trailingPrimer`) is kept whole, and so is `keep`, the paragraph put before
 * it, the line naming the kept skill (spec 024 D1). `command` is how the texts
 * name the CLI (`antigravityCommand`).
 */
export function capContext(text: string, command: string = SQUEAL_COMMAND, keep = ""): string {
  // A text that is the primer alone has no blank line before it.
  const primer = trailingPrimer(`\n\n${text}`).slice(2);
  const head = text.slice(0, text.length - primer.length).replace(/\n\n$/, "");
  const kept = [keep, primer].filter((p) => p !== "").join("\n\n");
  const tail = head === "" || kept === "" ? kept : `\n\n${kept}`;
  if (head.length + tail.length <= MESSAGE_CAP_CHARS) return `${head}${tail}`;
  const cut = cutLine(command);
  const room = MESSAGE_CAP_CHARS - tail.length - cut.length - 1;
  const start = head.slice(0, room);
  const line = start.lastIndexOf("\n");
  return `${line > 0 ? start.slice(0, line) : start}\n${cut}${tail}`;
}

/** SessionStart and PreInvocation: a system message the model reads before its next call. */
export function injectSystemMessage(
  text: string,
  command?: string,
  keep?: string,
): { injectSteps: { systemMessage: { systemMessage: string } }[] } {
  return { injectSteps: [{ systemMessage: { systemMessage: capContext(text, command, keep) } }] };
}

/** PreToolUse: the call does not run, and the model reads `reason` as its result. */
export function deny(reason: string, command?: string): { decision: "deny"; reason: string } {
  return { decision: "deny", reason: capContext(reason, command) };
}

/** Stop: the same turn continues with `reason` as a prompt (D3); a later Stop entry does not run. */
export function continueTurn(
  reason: string,
  command?: string,
): { decision: "continue"; reason: string } {
  return { decision: "continue", reason: capContext(reason, command) };
}
