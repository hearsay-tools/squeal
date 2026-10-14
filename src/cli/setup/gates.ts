import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { realName, resolved } from "./block.js";
import type { GateLine, Mention } from "./plan.js";

/*
 * Spec 005 D5: a gate line is a line of a committed instruction file that
 * runs the test command. The plan lists each with a proposed rewording to
 * `squeal run --all --wait <ms>`; each is written only on its own yes.
 * Mentions in other files, such as skills, are listed and never edited.
 */

/**
 * D5's `<ms>`: under the 120 s at which Claude Code's Bash tool stops a
 * command; Codex has no bound (`research/wave-0-checks.md` 2).
 */
export const GATE_WAIT_MS = 110_000;

const BEGIN = /^<!-- squeal:begin v\d+/;
const END = /^<!-- squeal:end -->/;
const FENCE = /^\s*(```|~~~)/;
/** A line already reworded: it runs the checkpoint, with the old command as its fallback. */
const REWORDED = /squeal run --all/;
/** A line naming Squeal is Squeal's own instruction, never a gate (row 005-47). */
const SQUEAL = /\bsqueal\b/i;
/** Words that, before the command in its sentence, tell the agent not to run it (row 005-47). */
const NEGATION = /\b(?:do not|don['’]t|never|instead of|avoid)\b/i;
/** A sentence's end, past closing quotes, brackets and emphasis. */
const SENTENCE_END = /[.!?][)\]*_"'”’]*$/;
/** A line that starts a block of its own, so the line before it ended its paragraph. */
const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#|>|\||```|~~~|<!--)/;
/** Shell syntax that runs more than one command: chains, pipes, background jobs, redirects, substitutions. */
const SHELL_OPERATOR = /&&|\|\||[;|&<>]|\$\(/;
/** An environment assignment, or `env`/`cross-env` setting one, ahead of the test command. */
const ENV_PREFIX = /(?:^|\s)(?:[A-Za-z_]\w*=|(?:cross-)?env\s)/;

/** The test commands D5 names; `node --test` only where node:test projects are. */
function commandPattern(nodeTest: boolean): RegExp {
  const commands = [
    "npx vitest(?: run)?",
    "vitest run",
    String.raw`npm(?: run)? test(?![\w:-])`,
    ...(nodeTest ? [String.raw`node (?:[^\s\`]+ )*--test(?![\w-])`] : []),
  ];
  return new RegExp(`(?<![\\w-])(?:${commands.join("|")})`);
}

export interface GateScan {
  readonly gates: readonly GateLine[];
  /** Lines naming the test command that are no gate: in other files, negated, or naming Squeal. */
  readonly mentions: readonly Mention[];
}

/** Files a harness reads as instructions: `AGENTS.md`, `CLAUDE.md` and `CLAUDE.local.md`, at any depth. */
function isInstructionFile(path: string): boolean {
  return ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md"].includes(posix.basename(path));
}

/** Where skills and agent settings live: mentions there are listed, not offered. */
function isAgentFile(path: string): boolean {
  return /^\.(claude|agents|codex)\//.test(path) && path.endsWith(".md");
}

export function scanGates(
  root: string,
  tracked: readonly string[],
  options: { readonly nodeTest: boolean },
): GateScan {
  const pattern = commandPattern(options.nodeTest);
  const gates: GateLine[] = [];
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  for (const path of tracked) {
    const instruction = isInstructionFile(path);
    if (!instruction && !isAgentFile(path)) continue;
    const real = resolved(root, path);
    if (seen.has(real)) continue;
    seen.add(real);
    // A symlink's lines are named by the file it resolves to (D4: one file, one block).
    const file = realName(root, real, path);
    let text: string;
    try {
      text = readFileSync(real, "utf8");
    } catch {
      continue;
    }
    for (const { line, text: lineText, command, fenced, next } of commandLines(text, pattern)) {
      if (!instruction || notRun(lineText, pattern)) mentions.push({ file, line, text: lineText });
      else {
        const reason = fenced
          ? "inside a code block"
          : (unfit(lineText, next, pattern) ??
            compound(lineText, pattern) ??
            subject(lineText, pattern));
        const proposed = reason === null ? reword(lineText, pattern) : null;
        gates.push({
          id: `${file}:${line}`,
          file,
          line,
          text: lineText,
          command,
          proposed,
          reason,
        });
      }
    }
  }
  return { gates, mentions };
}

interface Found {
  readonly line: number;
  readonly text: string;
  readonly command: string;
  readonly fenced: boolean;
  /** The line after it, `undefined` at the end of the file. */
  readonly next: string | undefined;
}

/** Lines running a test command, outside the Squeal block and not yet reworded. */
function commandLines(text: string, pattern: RegExp): Found[] {
  const found: Found[] = [];
  let fenced = false;
  let inBlock = false;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (BEGIN.test(line)) inBlock = true;
    if (inBlock) {
      if (END.test(line)) inBlock = false;
      return;
    }
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    const match = pattern.exec(line);
    if (match === null || REWORDED.test(line)) return;
    const command = commandOf(line, pattern);
    found.push({ line: i + 1, text: line, command, fenced, next: lines[i + 1] });
  });
  return found;
}

/** The command as written: the whole code span holding it, else the matched words. */
function commandOf(line: string, pattern: RegExp): string {
  for (const span of line.matchAll(/`([^`]+)`/g)) {
    if (pattern.test(span[1] as string)) return span[1] as string;
  }
  return (pattern.exec(line) as RegExpExecArray)[0];
}

/** Where the line's test command starts: its code span's backtick, else the matched words. */
function commandAt(line: string, pattern: RegExp): number {
  for (const span of line.matchAll(/`([^`]+)`/g)) {
    if (pattern.test(span[1] as string)) return span.index;
  }
  return (pattern.exec(line) as RegExpExecArray).index;
}

/** The line with each code span blanked, so a stop inside a command ends no sentence. */
function prose(line: string): string {
  return line.replace(/`[^`]*`/g, (span) => "x".repeat(span.length));
}

/** The part of the command's sentence before the command. */
function leadIn(line: string, pattern: RegExp): string {
  const at = commandAt(line, pattern);
  const last = [
    ...prose(line)
      .slice(0, at)
      .matchAll(/[.!?]\s+/g),
  ].at(-1);
  return line.slice(last === undefined ? 0 : last.index + last[0].length, at);
}

/** Where the sentence holding `from` ends, when another sentence follows it on the line. */
function sentenceEnd(line: string, from: number): number | null {
  const stop = /[.!?][)\]*_"'”’]*(?=\s+\S)/g;
  stop.lastIndex = from;
  const match = stop.exec(prose(line));
  return match === null ? null : match.index + match[0].length;
}

/**
 * Row 005-47: a line that names Squeal, or tells the agent not to run the
 * command, is no gate. Cezar's "Do not duplicate those background runs with
 * `npm test`," was reworded into an instruction to run it.
 */
function notRun(line: string, pattern: RegExp): boolean {
  return SQUEAL.test(line) || NEGATION.test(leadIn(line, pattern));
}

/**
 * Why the exit-3 sentence cannot follow the command's sentence, or `null`
 * when it can: a table row, or a sentence that goes on past the line (row
 * 005-47). A line with no closing stop ends its sentence only where its
 * paragraph ends.
 */
function unfit(line: string, next: string | undefined, pattern: RegExp): string | null {
  if (/^\s*\|/.test(line)) return "a table row";
  if (sentenceEnd(line, commandAt(line, pattern)) !== null) return null;
  const body = line.trimEnd();
  if (SENTENCE_END.test(body)) return null;
  const continued = next !== undefined && next.trim() !== "" && !BLOCK_START.test(next);
  if (/[,;:\-–—]$/.test(body) || continued) return "its sentence goes on past the line";
  return null;
}

/**
 * Row 005-47, cezar's "`npm test` and `npm run test:unit` are the fast unit
 * gate": a sentence that opens with the command says what the command is,
 * so the checkpoint cannot take its place.
 */
function subject(line: string, pattern: RegExp): string | null {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)?[*_]*$/.test(leadIn(line, pattern))
    ? "its sentence describes the test command rather than running it"
    : null;
}

/**
 * Why the line's test command cannot become the checkpoint in place, or
 * `null` when it can. D5 replaces the test command only, so a command that
 * also runs or scopes something else, such as lint before it or an
 * environment variable for it, is left for a human to reword (review 005-13
 * B2). A line with no code span is one command, so its prose is read too.
 */
function compound(line: string, pattern: RegExp): string | null {
  const spans = [...line.matchAll(/`([^`]+)`/g)].map((span) => span[1] as string);
  const testSpans = spans.filter((span) => pattern.test(span));
  const commands = testSpans.length > 0 ? testSpans : [line.trim()];
  const every = new RegExp(pattern.source, "g");
  const runs = commands.reduce((sum, command) => sum + (command.match(every)?.length ?? 0), 0);
  if (runs > 1) return "runs the test command more than once";
  for (const command of commands) {
    const at = (pattern.exec(command) as RegExpExecArray).index;
    if (SHELL_OPERATOR.test(command) || ENV_PREFIX.test(command.slice(0, at))) {
      return `runs more than the test command: \`${command}\``;
    }
  }
  return null;
}

/**
 * D5's rewording: every code span (or bare command) running the test
 * command becomes the checkpoint, and one sentence for the cases Squeal
 * cannot answer names the old command as the fallback. That sentence
 * follows the checkpoint's own, so its "it" is the checkpoint (row 005-47).
 */
export function reword(line: string, pattern: RegExp = commandPattern(true)): string {
  const command = commandOf(line, pattern);
  const checkpoint = `squeal run --all --wait ${GATE_WAIT_MS}`;
  let replaced = line.replace(/`([^`]+)`/g, (span, inner: string) =>
    pattern.test(inner) ? `\`${checkpoint}\`` : span,
  );
  if (replaced === line) replaced = line.replace(pattern, checkpoint);
  const fallback = `If it exits 3 at its deadline, run it again; if it exits 3 for another reason, \`squeal\` is unavailable, or you doubt its result, run \`${command}\` instead.`;
  const end = sentenceEnd(replaced, replaced.indexOf(checkpoint));
  if (end !== null) return `${replaced.slice(0, end)} ${fallback}${replaced.slice(end)}`;
  const body = replaced.trimEnd();
  const stop = SENTENCE_END.test(body) ? "" : ".";
  return `${body}${stop} ${fallback}`;
}

/**
 * Rewords the gate lines `ids` names, as the plan proposed them. Nothing is
 * written when an id names no gate line or one that cannot be reworded.
 */
export function rewordGates(
  root: string,
  tracked: readonly string[],
  ids: readonly string[],
  options: { readonly nodeTest: boolean },
): { readonly written: readonly string[] } | { readonly refused: string } {
  const { gates } = scanGates(root, tracked, options);
  const chosen: GateLine[] = [];
  for (const id of ids) {
    const gate = gates.find((g) => g.id === id);
    if (gate === undefined) return { refused: `no gate line ${id}` };
    if (gate.proposed === null) return { refused: `${id}: ${gate.reason}` };
    chosen.push(gate);
  }
  const byFile = new Map<string, GateLine[]>();
  for (const gate of chosen) byFile.set(gate.file, [...(byFile.get(gate.file) ?? []), gate]);
  for (const [file, lines] of byFile) {
    const real = resolved(root, file);
    const text = readFileSync(real, "utf8").split("\n");
    for (const gate of lines) text[gate.line - 1] = gate.proposed as string;
    writeFileSync(real, text.join("\n"));
  }
  return { written: chosen.map((g) => g.id) };
}
