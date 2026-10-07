import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/harness/claude-code/build.js";
import type { CodexHookName } from "../../../src/harness/codex/index.js";

/** Where Codex ran: `codex exec`, a `codex app-server` thread, or the TUI. */
export type Mode = "exec" | "app-server" | "tui";
export const MODES: readonly Mode[] = ["exec", "app-server", "tui"];

const FIXTURES = join(REPO_ROOT, "test/fixtures/codex-hooks");

/** The recorded fixtures of `mode`, by file name without `.json`. */
export function fixtureNames(mode: Mode): string[] {
  return readdirSync(join(FIXTURES, mode))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** The recorded input as an object, `cwd` pointed at `cwd`. */
export function codexInput(
  mode: Mode,
  name: string,
  cwd: string,
  overrides: object = {},
): Record<string, unknown> {
  const input = JSON.parse(readFileSync(join(FIXTURES, mode, `${name}.json`), "utf8")) as object;
  return { ...input, cwd, ...overrides };
}

/** The recorded input as stdin text, `cwd` pointed at `cwd`. */
export function codexRecorded(
  mode: Mode,
  name: string,
  cwd: string,
  overrides: object = {},
): string {
  return JSON.stringify(codexInput(mode, name, cwd, overrides));
}

/** The bundle that serves each Codex event: the wave-1 contract's entries. */
export const HOOK_OF_EVENT: Readonly<Record<string, CodexHookName>> = {
  SessionStart: "session-start",
  UserPromptSubmit: "user-prompt-submit",
  PreToolUse: "pre-tool-use",
  PostToolUse: "post-tool-use",
  Stop: "stop",
  SubagentStart: "subagent-start",
  SubagentStop: "subagent-stop",
  Interrupt: "interrupt",
  SessionEnd: "session-end",
};

/** Every recorded fixture as `[mode, name, event]`. */
export function allFixtures(): (readonly [Mode, string, string])[] {
  return MODES.flatMap((mode) =>
    fixtureNames(mode).map(
      (name) => [mode, name, String(codexInput(mode, name, "/").hook_event_name)] as const,
    ),
  );
}
