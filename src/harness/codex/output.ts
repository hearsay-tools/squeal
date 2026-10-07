import { PRIMER } from "../shared/primer.js";

/*
 * Codex hook output shapes (spec 002 D3): `hookSpecificOutput.additionalContext`
 * for SessionStart, UserPromptSubmit and PostToolUse; `permissionDecision` for
 * PreToolUse; `decision` and `reason` for Stop. Exit 2 is never used.
 */

/**
 * Spec 002 D3: SessionStart output "is capped at 8,000 characters, under
 * Codex's default spill threshold of about 2,500 tokens", so the model sees
 * all of it, not a head, a tail and a file path (research, codex-hooks 3).
 * Every text a Codex hook gives the model is held to it.
 */
export const CONTEXT_CAP_CHARS = 8_000;

const CUT_LINE = "SQUEAL · cut to fit a Codex hook; `squeal status` has the rest.";

/**
 * `text` within `CONTEXT_CAP_CHARS`. A longer one is cut at a line boundary
 * and says so; a trailing primer is kept whole, since the shared formats cap
 * at 10,000 characters with the primer last.
 */
export function capContext(text: string): string {
  if (text.length <= CONTEXT_CAP_CHARS) return text;
  const tail = text.endsWith(`\n\n${PRIMER}`) ? `\n\n${PRIMER}` : "";
  const room = CONTEXT_CAP_CHARS - tail.length - CUT_LINE.length - 1;
  const head = text.slice(0, text.length - tail.length).slice(0, room);
  const end = head.lastIndexOf("\n");
  return `${end > 0 ? head.slice(0, end) : head}\n${CUT_LINE}${tail}`;
}

export type ContextEvent = "SessionStart" | "UserPromptSubmit" | "PostToolUse";

/** Context the model reads before its next step. */
export function additionalContext(event: ContextEvent, text: string): object {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: capContext(text) } };
}

/** PreToolUse: the call does not run, and the model reads `reason` as its result. */
export function deny(reason: string): object {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: capContext(reason),
    },
  };
}

/** Stop: the same turn continues with `reason` as a prompt (research, codex-hooks 5). */
export function block(reason: string): object {
  return { decision: "block", reason: capContext(reason) };
}
