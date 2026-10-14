import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { realName, resolved } from "./block.js";
import type { GateLine, Mention } from "./plan.js";

/*
 * Spec 005 D5: a gate line is a line of a committed instruction file that
 * runs the test command. The plan lists each with a proposed rewording to
 * `squeal run --all --wait <ms>`; each is written only on its own yes.
 * Every other line naming the command, in a skill or in prose that does not
 * tell the agent to run it, is a mention: listed and never edited.
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
/**
 * Row 005-55, review 005-54: a gate is allowed, never inferred by ruling
 * prose out. The sentence holding the command opens, after an optional list
 * marker, emphasis or a one- or two-word `Label:`, with one of these
 * imperatives, or is D5's first example: `Verification:` and the commands'
 * code spans. From the review's corpus of 80 proposals, the true
 * instructions open with `Run` ("Run one full ...") and `Before you finish,
 * run`; `Use`, `Execute` and `Verify with` are the brief's, and `Always`,
 * `Also` or `Then` may precede any. A longer label let "Same prompt within
 * each matrix: run exactly ..." pass for one; "Use of" and "Run-time" are nouns.
 */
const INSTRUCTION =
  /^(?:[-*+]\s+|\d+[.)]\s+)?[*_]*(?:verification:[*_]*\s+(?=`)|(?:[a-z]\w*(?: \w+)?:[*_]*\s+)?(?:(?:always|also|then),?\s+)?(?:run|use|execute|verify with|before you finish,\s+run)\s(?!\s*of\b))/i;
/** Only command-list items and execution modifiers may separate the verb from its object (005-58 R2). */
const OBJECT_PREFIX = /^(?:(?:exactly|one|full|and|then)\s+|`[^`]+`[\s,]*)*$/i;
/** A documented example is not an instruction to execute the command (005-58 R2). */
const EXAMPLE = /\bas\s+an?\s+example\b/i;
/** Quoted prose, including an unclosed quotation: its commands and stops are examples (005-58 R1). */
const QUOTATION = /"[^"]*(?:"|$)|“[^”]*(?:”|$)/g;
/** Words that, before the command in its sentence, tell the agent not to run it (row 005-47). */
const NEGATION = /\b(?:do not|don['’]t|never|not|instead of|rather than|avoid|without|except)\b/i;
/** A stop's closing quotes, brackets and emphasis. */
const CLOSERS = /^[)\]*_"'”’]*/;
/** Stops that end no sentence: "e.g. via", "i.e. not" (review 005-54 B2, B3). */
const ABBREVIATION = /(?:^|[^\w.])(?:e\.g|i\.e|etc|vs|cf)$/i;
/** A line that starts a block of its own, so the line before it ended its paragraph. */
const BLOCK_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#|>|\||```|~~~|<!--)/;
/** A line that is a block by itself, so the line after it starts anew. */
const ONE_LINE_BLOCK = /^\s*(?:#|\||```|~~~|<!--)|-->\s*$/;
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
  /** Lines naming the test command that are no gate: in other files, or not an instruction to run it. */
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
    for (const found of commandLines(text, pattern)) {
      const { line, text: lineText, command, next } = found;
      if (!instruction || !instructs(found, pattern)) {
        mentions.push({ file, line, text: lineText });
      } else {
        const reason = unfit(lineText, next, pattern) ?? compound(lineText, pattern);
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

/**
 * The first line naming Squeal outside the managed block of an instruction
 * file, `null` when none does. Cezar's AGENTS.md held a hand-written Squeal
 * paragraph, and setup reported "no Squeal block" beside it (row 005-47).
 */
export function squealLine(root: string, path: string): Mention | null {
  let text: string;
  try {
    text = readFileSync(resolved(root, path), "utf8");
  } catch {
    return null;
  }
  let inBlock = false;
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (BEGIN.test(line)) inBlock = true;
    if (inBlock) {
      if (END.test(line)) inBlock = false;
      continue;
    }
    if (SQUEAL.test(line)) return { file: path, line: i + 1, text: line };
  }
  return null;
}

interface Found {
  readonly line: number;
  readonly text: string;
  readonly command: string;
  readonly fenced: boolean;
  /** The lines before and after it, `undefined` at either end of the file. */
  readonly previous: string | undefined;
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
    found.push({
      line: i + 1,
      text: line,
      command,
      fenced,
      previous: lines[i - 1],
      next: lines[i + 1],
    });
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

/**
 * Where each sentence on the line ends, past its stop's closing marks. A
 * stop inside brackets or after an abbreviation ends none: review 005-54
 * found "e.g." and "(e.g. after code review)." split sentences (B2, B3).
 */
function stops(line: string): number[] {
  const text = prose(line).replace(QUOTATION, (quote) => "x".repeat(quote.length));
  const ends: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (depth === 0 && ".!?".includes(c) && !ABBREVIATION.test(text.slice(0, i))) {
      const end = i + 1 + (CLOSERS.exec(text.slice(i + 1)) as RegExpExecArray)[0].length;
      if (end === text.length || /\s/.test(text[end] as string)) ends.push(end);
    }
  }
  return ends;
}

/** Whether the line's last sentence ends with it. */
function endsSentence(line: string): boolean {
  return stops(line).at(-1) === line.trimEnd().length;
}

/** Where the sentence holding `from` ends, when another sentence follows it on the line. */
function sentenceEnd(line: string, from: number): number | null {
  const end = stops(line).find((at) => at > from);
  return end === undefined || line.slice(end).trim() === "" ? null : end;
}

/**
 * Row 005-55: whether the line tells the agent to run the test command,
 * the allow-list review 005-54 asked for. Outside a code block, not naming
 * Squeal (row 005-47), the command's sentence starts on this line, opens
 * with an instruction and holds no negation before the command. Any other
 * line is a mention: "The `npm test` command runs the unit suite." and
 * "Do not run the whole suite,\nincluding `npm test`." each became one.
 */
function instructs(found: Found, pattern: RegExp): boolean {
  const { text: line, fenced, previous } = found;
  if (fenced || SQUEAL.test(line)) return false;
  const at = commandAt(line, pattern);
  if (
    [...prose(line).matchAll(QUOTATION)].some((q) => q.index <= at && at < q.index + q[0].length)
  ) {
    return false;
  }
  const start = stops(line)
    .filter((end) => end <= at)
    .at(-1);
  if (start === undefined && continues(previous, line)) return false;
  const sentence = line.slice(start ?? 0, at).trimStart();
  const instruction = INSTRUCTION.exec(sentence);
  if (instruction === null || NEGATION.test(sentence)) return false;
  const end = sentenceEnd(line, at) ?? line.length;
  if (EXAMPLE.test(prose(line).slice(at, end))) return false;
  // A bare compound command still gets its existing refusal reason, never a proposal.
  return (
    OBJECT_PREFIX.test(sentence.slice(instruction[0].length)) || compound(line, pattern) !== null
  );
}

/** Whether `line` goes on with a sentence begun on the line before it. */
function continues(previous: string | undefined, line: string): boolean {
  if (previous === undefined || previous.trim() === "") return false;
  if (BLOCK_START.test(line) || ONE_LINE_BLOCK.test(previous)) return false;
  return !endsSentence(previous);
}

/**
 * Why the exit-3 sentence cannot follow the command's sentence, or `null`
 * when it can: the sentence goes on past the line (row 005-47). A line with
 * no closing stop ends its sentence only where its paragraph ends.
 */
function unfit(line: string, next: string | undefined, pattern: RegExp): string | null {
  if (sentenceEnd(line, commandAt(line, pattern)) !== null || endsSentence(line)) return null;
  const continued = next !== undefined && next.trim() !== "" && !BLOCK_START.test(next);
  if (/[,;:\-–—]$/.test(line.trimEnd()) || continued) return "its sentence goes on past the line";
  return null;
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
  return `${body}${endsSentence(body) ? "" : "."} ${fallback}`;
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
