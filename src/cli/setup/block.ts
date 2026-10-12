import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { HarnessId } from "./harnesses.js";
import type { BlockState, InstructionFile } from "./plan.js";

/*
 * Spec 005 D4: the instruction block, `research/instruction-surfaces.md`
 * wording `b2` and one sentence deferring to the file's own verification
 * steps, between markers that name its version.
 */

export const BLOCK_VERSION = 1;
const BEGIN = /^<!-- squeal:begin v(\d+)\b.*-->\s*$/;
const END = /^<!-- squeal:end -->\s*$/;

/** The runners the block names, as the primer does (`src/harness/shared/primer.ts`). */
export interface BlockRunners {
  readonly vitest: boolean;
  readonly nodeTest: boolean;
}

export function blockText(runners: BlockRunners = { vitest: true, nodeTest: false }): string {
  const names = [
    ...(runners.vitest || !runners.nodeTest ? ["Vitest"] : []),
    ...(runners.nodeTest ? ["node:test"] : []),
  ];
  const fallback = names.includes("Vitest")
    ? `\`npx vitest run\`${runners.nodeTest ? " and the node:test projects" : ""}`
    : "the node:test projects yourself";
  return [
    `<!-- squeal:begin v${BLOCK_VERSION} (managed by Squeal setup; edits inside are replaced) -->`,
    "## Tests",
    "",
    `Squeal runs the ${names.join(" and ")} tests after each edit. Before you say the work is done, run \`squeal status --wait 60000\` (or the command the SQUEAL messages name) and report its known failures and pending checks instead of running ${names.join(" or ")}. If you have seen no SQUEAL message in this session, run ${fallback} instead. Where this file's verification steps name a test command, they take precedence.`,
    "<!-- squeal:end -->",
    "",
  ].join("\n");
}

/** Where the block lies in `text`: 0-based line indexes, `end` exclusive. */
type Span =
  | { readonly found: false }
  | { readonly found: true; readonly version: number; readonly begin: number; readonly end: number }
  | { readonly found: "unterminated"; readonly begin: number };

function findBlock(lines: readonly string[]): Span {
  const begin = lines.findIndex((line) => BEGIN.test(line));
  if (begin === -1) return { found: false };
  const end = lines.findIndex((line, i) => i > begin && END.test(line));
  if (end === -1) return { found: "unterminated", begin };
  return {
    found: true,
    version: Number(BEGIN.exec(lines[begin] as string)?.[1]),
    begin,
    end: end + 1,
  };
}

export function readBlock(text: string): BlockState {
  const span = findBlock(text.split("\n"));
  if (span.found === false) return { state: "absent" };
  if (span.found === "unterminated") return { state: "unterminated", line: span.begin + 1 };
  return {
    state: span.version < BLOCK_VERSION ? "outdated" : "current",
    version: span.version,
    line: span.begin + 1,
  };
}

/**
 * `text` with the block written: what lies between the markers replaced, or
 * the block appended after a blank line. A begin marker without its end is
 * refused, as its 1-based line.
 */
export function withBlock(text: string, block: string): string | { readonly unterminated: number } {
  const lines = text.split("\n");
  const span = findBlock(lines);
  if (span.found === "unterminated") return { unterminated: span.begin + 1 };
  const blockLines = block.replace(/\n$/, "").split("\n");
  if (span.found === true) {
    return [...lines.slice(0, span.begin), ...blockLines, ...lines.slice(span.end)].join("\n");
  }
  const body = text.replace(/\n*$/, "");
  return body === "" ? block : `${body}\n\n${block}`;
}

/** `text` without the block and the blank line before it; `null` when it holds none. */
export function withoutBlock(text: string): string | null | { readonly unterminated: number } {
  const lines = text.split("\n");
  const span = findBlock(lines);
  if (span.found === false) return null;
  if (span.found === "unterminated") return { unterminated: span.begin + 1 };
  const before = lines.slice(0, span.begin);
  const after = lines.slice(span.end);
  if (after.every((line) => line === "") && before.at(-1) === "") before.pop();
  const rest = [...before, ...after].join("\n");
  return rest.replace(/\n*$/, "") === "" ? "" : rest;
}

/** Files Claude Code reads instead of `AGENTS.md` (D4). */
const CLAUDE_FILES = ["CLAUDE.md", join(".claude", "CLAUDE.md"), "CLAUDE.local.md"];

/**
 * D4: the file each harness reads, grouped by the file they resolve to
 * through symlinks. Codex reads `AGENTS.md`. Claude Code reads it only with
 * no Claude file at the root or above, or with an `@AGENTS.md` import;
 * otherwise `CLAUDE.md`.
 */
export function instructionFiles(root: string, tracked: readonly string[]): InstructionFile[] {
  const claude = claudeReadsAgents(root) ? "AGENTS.md" : "CLAUDE.md";
  const wanted: [HarnessId, string][] = [
    ["claude-code", claude],
    ["codex", "AGENTS.md"],
  ];
  const files = new Map<string, { paths: string[]; harnesses: HarnessId[] }>();
  for (const [harness, path] of wanted) {
    const real = resolved(root, path);
    const entry = files.get(real) ?? { paths: [], harnesses: [] };
    if (!entry.paths.includes(path)) entry.paths.push(path);
    entry.harnesses.push(harness);
    files.set(real, entry);
  }
  return [...files].map(([real, { paths, harnesses }]) => {
    const path = realName(root, real, paths[0] as string);
    const text = readOrNull(real);
    return {
      path,
      aliases: paths.filter((p) => p !== path),
      harnesses,
      exists: text !== null,
      tracked: tracked.includes(path),
      block: text === null ? { state: "absent" } : readBlock(text),
    };
  });
}

function claudeReadsAgents(root: string): boolean {
  const imports = [CLAUDE_FILES[0], CLAUDE_FILES[1]].some((file) =>
    /(^|\s)@(\.\/)?AGENTS\.md\b/m.test(readOrNull(join(root, file as string)) ?? ""),
  );
  if (imports) return true;
  for (let dir = root; ; dir = dirname(dir)) {
    if (CLAUDE_FILES.some((file) => existsSync(join(dir, file)))) return false;
    if (dirname(dir) === dir) return true;
  }
}

/** The real path of `path` under `root`, following a symlink whose target does not exist yet. */
export function resolved(root: string, path: string): string {
  const absolute = join(root, path);
  try {
    return realpathSync(absolute);
  } catch {
    const link = lstatSync(absolute, { throwIfNoEntry: false });
    if (link?.isSymbolicLink() !== true)
      return join(realpathSync(dirname(absolute)), basename(absolute));
    return join(realpathSync(dirname(absolute)), readlinkSync(absolute));
  }
}

/** `real` relative to `root` when it lies inside, else `fallback`. */
function realName(root: string, real: string, fallback: string): string {
  const inside = relative(root, real);
  return inside !== "" && !inside.startsWith("..") ? inside : fallback;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** What writing or removing the block did to one file, for the command's output. */
export type BlockEdit =
  | { readonly path: string; readonly result: "written" | "unchanged" | "removed" | "deleted" }
  | { readonly path: string; readonly result: "unterminated"; readonly line: number };

/** Writes the block into `path` (worktree-relative; a symlink's target is written). */
export function writeBlockFile(root: string, path: string, block: string): BlockEdit {
  const real = resolved(root, path);
  const before = readOrNull(real) ?? "";
  const after = withBlock(before, block);
  if (typeof after !== "string") return { path, result: "unterminated", line: after.unterminated };
  if (after === before) return { path, result: "unchanged" };
  writeFileSync(real, after);
  return { path, result: "written" };
}

/**
 * Takes the block out of every file a harness may read at the root, each
 * real file once; a file left empty is deleted, since setup made it.
 */
export function removeBlocks(root: string): BlockEdit[] {
  const edits: BlockEdit[] = [];
  const seen = new Set<string>();
  for (const path of ["AGENTS.md", ...CLAUDE_FILES]) {
    if (!existsSync(join(root, path))) continue;
    const real = resolved(root, path);
    if (seen.has(real)) continue;
    seen.add(real);
    const named = realName(root, real, path);
    const text = readOrNull(real);
    const after = text === null ? null : withoutBlock(text);
    if (after === null) continue;
    if (typeof after !== "string") {
      edits.push({ path: named, result: "unterminated", line: after.unterminated });
    } else if (after === "") {
      rmSync(real);
      edits.push({ path: named, result: "deleted" });
    } else {
      writeFileSync(real, after);
      edits.push({ path: named, result: "removed" });
    }
  }
  return edits;
}
