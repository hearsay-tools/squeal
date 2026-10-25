import { type CommandContext, DESCRIPTIONS, type TestCommand } from "../../runners/descriptions.js";

export type { CommandContext, TestCommand };

/*
 * Spec 005 D8 step 1: recognize an agent's own test command, narrowly. The
 * rule is resolve or fall through: anything not recognized here runs as
 * normal, so every doubt is `null`. Each runner's description says how its
 * own commands look (spec 016 D5).
 */

/**
 * The test command `command` is, or `null` for one that falls through: a
 * chain, pipe, redirect, subshell, expansion or leading assignment, another
 * runner, a workspace flag, or a flag that changes what runs.
 */
export function recognizeTestCommand(command: string, context: CommandContext): TestCommand | null {
  const words = shellWords(command);
  if (words === null) return null;
  for (const description of DESCRIPTIONS) {
    const recognized = description.command(words, context, shellWords);
    if (recognized !== null) return recognized;
  }
  return null;
}

/**
 * Spec 005 D8: the shell command of a `Bash` call's hook input, from its
 * `tool_input.command`, as both harnesses send it; nothing for another tool.
 */
export function bashCommand(input: Readonly<Record<string, unknown>>): { command?: string } {
  const toolInput = input.tool_input;
  if (input.tool_name !== "Bash" || typeof toolInput !== "object" || toolInput === null) return {};
  const { command } = toolInput as Record<string, unknown>;
  return typeof command === "string" ? { command } : {};
}

/**
 * Characters a shell acts on outside quotes. Newlines chain; `#` starts a
 * comment; `*?[]{}~` expand to paths only the shell would know.
 */
const SPECIAL = /[|&;()<>$`\\#*?[\]{}~!\n\r]/;

/**
 * The words of `text` with quotes removed, or `null` when a shell would act
 * on anything in it: chains, pipes, redirects, subshells, expansions and
 * globs, or a leading assignment. Single quotes keep everything; double
 * quotes refuse `$`, `` ` `` and `\`.
 */
export function shellWords(text: string): string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char === " " || char === "\t") {
      if (word !== null) words.push(word);
      word = null;
    } else if (char === "'" || char === '"') {
      const end = text.indexOf(char, i + 1);
      if (end === -1) return null;
      const quoted = text.slice(i + 1, end);
      if (char === '"' && /[$`\\]/.test(quoted)) return null;
      word = (word ?? "") + quoted;
      i = end;
    } else if (SPECIAL.test(char)) {
      return null;
    } else {
      word = (word ?? "") + char;
    }
  }
  if (word !== null) words.push(word);
  if (words.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] as string)) return null;
  return words;
}
