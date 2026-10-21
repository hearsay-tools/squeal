import { SQUEAL_COMMAND } from "../../core/delivery/index.js";
import { trailingPrimer } from "../shared/primer.js";

/*
 * Codex hook output shapes (spec 002 D3): `hookSpecificOutput.additionalContext`
 * for SessionStart, SubagentStart, UserPromptSubmit and PostToolUse; `permissionDecision` for
 * PreToolUse; `decision` and `reason` for Stop. Exit 2 is never used.
 */

/**
 * Spec 002 D3: SessionStart output "is capped at 8,000 characters, under
 * Codex's default spill threshold of about 2,500 tokens", so the model sees
 * all of it, not a head, a tail and a file path (research, codex-hooks 3).
 * Every text a Codex hook gives the model is held to it.
 */
export const CONTEXT_CAP_CHARS = 8_000;

const cutLine = (command: string) =>
  `SQUEAL · cut to fit a Codex hook; \`${command} status\` has the rest.`;

/**
 * `text` within `CONTEXT_CAP_CHARS`. A longer one is cut at a line boundary
 * and says so; a trailing primer (`trailingPrimer`) is kept whole, since the shared formats cap
 * at 10,000 characters with the primer last. `keep`, a paragraph put before
 * that primer, is kept whole with it: the line naming the kept skill (spec
 * 005 D3 as amended 2026-10-21). `command` is how the texts name the CLI
 * (`codexCommand`).
 */
export function capContext(text: string, command: string = SQUEAL_COMMAND, keep = ""): string {
  // A text that is the primer alone, as after `compact`, has no blank line before it.
  const primer = trailingPrimer(`\n\n${text}`).slice(2);
  const head = text.slice(0, text.length - primer.length).replace(/\n\n$/, "");
  const kept = [keep, primer].filter((p) => p !== "").join("\n\n");
  const tail = head === "" || kept === "" ? kept : `\n\n${kept}`;
  if (head.length + tail.length <= CONTEXT_CAP_CHARS) return `${head}${tail}`;
  const cut = cutLine(command);
  const room = CONTEXT_CAP_CHARS - tail.length - cut.length - 1;
  const start = head.slice(0, room);
  const line = start.lastIndexOf("\n");
  return `${line > 0 ? start.slice(0, line) : start}\n${cut}${tail}`;
}

export type ContextEvent = "SessionStart" | "SubagentStart" | "UserPromptSubmit" | "PostToolUse";

/** Context the model reads before its next step; `keep` as `capContext` keeps it. */
export function additionalContext(
  event: ContextEvent,
  text: string,
  command?: string,
  keep?: string,
): object {
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: capContext(text, command, keep),
    },
  };
}

/** PreToolUse: the call does not run, and the model reads `reason` as its result. */
export function deny(reason: string, command?: string): object {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: capContext(reason, command),
    },
  };
}

/** Stop: the same turn continues with `reason` as a prompt (research, codex-hooks 5). */
export function block(reason: string, command?: string): object {
  return { decision: "block", reason: capContext(reason, command) };
}
