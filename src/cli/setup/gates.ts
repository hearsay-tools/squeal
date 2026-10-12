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
    for (const { line, text: lineText, command, fenced } of commandLines(text, pattern)) {
      if (!instruction) mentions.push({ file, line, text: lineText });
      else {
        const proposed = fenced ? null : reword(lineText, pattern);
        gates.push({ id: `${file}:${line}`, file, line, text: lineText, command, proposed });
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
}

/** Lines running a test command, outside the Squeal block and not yet reworded. */
function commandLines(text: string, pattern: RegExp): Found[] {
  const found: Found[] = [];
  let fenced = false;
  let inBlock = false;
  text.split("\n").forEach((line, i) => {
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
    found.push({ line: i + 1, text: line, command: commandOf(line, pattern), fenced });
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

/**
 * D5's rewording: every code span (or bare command) running the test
 * command becomes the checkpoint, and one sentence for the cases Squeal
 * cannot answer names the old command as the fallback.
 */
export function reword(line: string, pattern: RegExp = commandPattern(true)): string {
  const command = commandOf(line, pattern);
  const checkpoint = `squeal run --all --wait ${GATE_WAIT_MS}`;
  let replaced = line.replace(/`([^`]+)`/g, (span, inner: string) =>
    pattern.test(inner) ? `\`${checkpoint}\`` : span,
  );
  if (replaced === line) replaced = line.replace(pattern, checkpoint);
  const body = replaced.trimEnd();
  const stop = /[.!?:]$/.test(body) ? "" : ".";
  return `${body}${stop} If it exits 3 at its deadline, run it again; if it exits 3 for another reason, \`squeal\` is unavailable, or you doubt its result, run \`${command}\` instead.`;
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
    if (gate.proposed === null) return { refused: `${id} is inside a code block` };
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
