import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceMap } from "./bundle.js";
import { type Overlay, ROOT } from "./trees.js";

/*
 * The coverage proof (task 011-37 section 3; 011-35 Q4, risk 1): every line
 * that differs between the two bundles and was emitted from a changed source
 * line ran in some case, a line the candidate added at the candidate and a
 * line it removed at the last release. A comment or a type emits no line; a
 * line that differs only because esbuild renamed an identifier to keep two
 * modules' names apart maps to no changed source line, so neither needs a case.
 * V8's block coverage (`NODE_V8_COVERAGE`) reports every function of the
 * script, a never-called one with count 0, so the innermost range at a line's
 * first character says whether the block it lies in ran in that process. A
 * line ran when it ran in any process: each report is read on its own, since a
 * process that never called a function, or skipped a branch V8 reports for it
 * alone, holds a range at least as small as the one where it ran.
 */

export interface Range {
  readonly start: number;
  readonly end: number;
  readonly count: number;
}

/** The block ranges V8 wrote under `dir` for the script at `url`, one list per process that loaded it. */
export function coverageOf(dir: string, url: string): Range[][] {
  const reports: Range[][] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const report = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
      result: {
        url: string;
        functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[];
      }[];
    };
    for (const script of report.result.filter((s) => s.url === url)) {
      reports.push(
        script.functions.flatMap((fn) =>
          fn.ranges.map((r) => ({ start: r.startOffset, end: r.endOffset, count: r.count })),
        ),
      );
    }
  }
  return reports;
}

/** The count of the innermost range holding `offset`; 0 outside every range. */
function countAt(ranges: readonly Range[], offset: number): number {
  let best: Range | null = null;
  for (const r of ranges) {
    if (
      r.start <= offset &&
      offset < r.end &&
      (best === null || r.end - r.start < best.end - best.start)
    ) {
      best = r;
    }
  }
  return best?.count ?? 0;
}

/** Of `lines` (1-based) of `text`, those holding code whose block ran in none of `reports`. Blank lines hold none. */
export function unrun(
  text: string,
  reports: readonly (readonly Range[])[],
  lines: Iterable<number>,
): number[] {
  const all = text.split("\n");
  const starts: number[] = [];
  let at = 0;
  for (const line of all) {
    starts.push(at);
    at += line.length + 1;
  }
  const out: number[] = [];
  for (const n of lines) {
    const line = all[n - 1] ?? "";
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    const offset = (starts[n - 1] ?? 0) + indent;
    if (reports.every((ranges) => countAt(ranges, offset) === 0)) out.push(n);
  }
  return out;
}

export interface ChangedLines {
  /** Lines of the first text the second lacks, 1-based. */
  readonly removed: number[];
  /** Lines of the second text the first lacks, 1-based. */
  readonly added: number[];
}

/** The line diff of two files, through `git diff --no-index`. */
export function changedLines(from: string, to: string): ChangedLines {
  const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--unified=0", from, to], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (diff.status !== 0 && diff.status !== 1) throw new Error(`git diff: ${diff.stderr}`);
  const removed: number[] = [];
  const added: number[] = [];
  for (const m of diff.stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [at, count, toAt, toCount] = [m[1], m[2], m[3], m[4]].map((v) => Number(v ?? 1));
    for (let i = 0; i < (count ?? 0); i++) removed.push((at ?? 0) + i);
    for (let i = 0; i < (toCount ?? 0); i++) added.push((toAt ?? 0) + i);
  }
  return { removed, added };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * A bundle's source path as both sides name it: relative to its tree when
 * under it, else to this checkout, where the harness both sides run lives.
 */
function named(path: string, tree: string): string {
  const base = [tree, ROOT].find((dir) => path.startsWith(`${dir}${sep}`));
  return (base === undefined ? path : relative(base, path)).split(sep).join("/");
}

/** Every `path:line` (1-based) each generated line (1-based) was emitted from. */
export function mappedLines(map: SourceMap, tree: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let source = 0;
  let line = 0;
  for (const [index, text] of map.mappings.split(";").entries()) {
    for (const segment of text.split(",").filter((s) => s !== "")) {
      const fields = vlq(segment);
      if (fields.length < 4) continue;
      source += fields[1] ?? 0;
      line += fields[2] ?? 0;
      const at = `${named(map.sources[source] ?? "?", tree)}:${line + 1}`;
      const lines = out.get(index + 1) ?? [];
      if (!lines.includes(at)) lines.push(at);
      out.set(index + 1, lines);
    }
  }
  return out;
}

/** One side's bundle for `changedSources`: its source map and its tree, `overlay`'s texts in place. */
export interface SourceSide {
  readonly map: SourceMap;
  readonly tree: string;
  readonly overlay?: Overlay;
}

/**
 * The text `side` has at `path`: what its bundle compiled there (overlays and
 * the pinned format included), else the file of its tree, else none. A path
 * outside `src/` is the harness's, this checkout's at both sides.
 */
function textAt(side: SourceSide, bundled: ReadonlyMap<string, string>, path: string) {
  const compiled = bundled.get(path);
  if (compiled !== undefined) return compiled;
  const own = path.startsWith("src/");
  if (own && side.overlay?.[path] !== undefined) return side.overlay[path];
  const file = join(own ? side.tree : ROOT, path);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * The source lines that differ between the two trees, as `path:line` at each
 * side, for every path either bundle compiled (task 011-40, the
 * coordinator's conditions of 2026-10-20). A path only one tree has is
 * changed in every line at that side; a path whose texts differ counts its
 * diff's lines at each side, deleted lines at the baseline included; a path
 * the trees hold alike counts none, even when only one bundle holds it. A
 * bundle stops holding a module when no entry or harness module imports it
 * any longer: the import's own line is the change, and the module's
 * unchanged lines vouch for nothing new.
 */
export function changedSources(
  baseline: SourceSide,
  candidate: SourceSide,
  dir: string,
): { readonly baseline: Set<string>; readonly candidate: Set<string> } {
  const texts = (side: SourceSide) =>
    new Map(
      side.map.sources.map((s, i) => [named(s, side.tree), side.map.sourcesContent?.[i] ?? ""]),
    );
  const before = texts(baseline);
  const after = texts(candidate);
  const out = { baseline: new Set<string>(), candidate: new Set<string>() };
  mkdirSync(dir, { recursive: true });
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const [a, b] = [textAt(baseline, before, path) ?? "", textAt(candidate, after, path) ?? ""];
    if (a === b) continue;
    const [from, to] = [join(dir, "a"), join(dir, "b")];
    writeFileSync(from, a);
    writeFileSync(to, b);
    const lines = changedLines(from, to);
    for (const n of lines.removed) out.baseline.add(`${path}:${n}`);
    for (const n of lines.added) out.candidate.add(`${path}:${n}`);
  }
  return out;
}
