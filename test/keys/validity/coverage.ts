import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceMap } from "./bundle.js";

/*
 * The coverage proof (task 011-37 section 3; 011-35 Q4, risk 1): every line
 * that differs between the two bundles and was emitted from a changed source
 * line ran in some case, a line the candidate added at the candidate and a
 * line it removed at the last release. A comment or a type emits no line; a
 * line that differs only because esbuild renamed an identifier to keep two
 * modules' names apart maps to no changed source line, so neither needs a case.
 * V8's block coverage (`NODE_V8_COVERAGE`) reports every function of the
 * script, a never-called one with count 0, so the innermost range at a line's
 * first character says whether the block it lies in ran.
 */

export interface Range {
  readonly start: number;
  readonly end: number;
  readonly count: number;
}

/** The block ranges V8 wrote under `dir` for the script at `url`. */
export function coverageOf(dir: string, url: string): Range[] {
  const ranges: Range[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const report = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
      result: {
        url: string;
        functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[];
      }[];
    };
    for (const script of report.result.filter((s) => s.url === url)) {
      for (const fn of script.functions) {
        for (const r of fn.ranges)
          ranges.push({ start: r.startOffset, end: r.endOffset, count: r.count });
      }
    }
  }
  return ranges;
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

/** Of `lines` (1-based) of `text`, those holding code whose block never ran. Blank lines hold none. */
export function unrun(text: string, ranges: readonly Range[], lines: Iterable<number>): number[] {
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
    if (countAt(ranges, (starts[n - 1] ?? 0) + indent) === 0) out.push(n);
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

/** A bundle's source path as both sides name it: relative to its tree when under it. */
function named(path: string, tree: string): string {
  const shown = path.startsWith(`${tree}${sep}`) ? relative(tree, path) : path;
  return shown.split(sep).join("/");
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

/**
 * The source lines that differ between two bundles' sources, as `path:line`
 * at each side: what each bundle compiled (`sourcesContent`, overlays and the
 * pinned format included), diffed file by file under `dir`.
 */
export function changedSources(
  baseline: { readonly map: SourceMap; readonly tree: string },
  candidate: { readonly map: SourceMap; readonly tree: string },
  dir: string,
): { readonly baseline: Set<string>; readonly candidate: Set<string> } {
  const texts = (side: typeof baseline) =>
    new Map(
      side.map.sources.map((s, i) => [named(s, side.tree), side.map.sourcesContent?.[i] ?? ""]),
    );
  const before = texts(baseline);
  const after = texts(candidate);
  const out = { baseline: new Set<string>(), candidate: new Set<string>() };
  mkdirSync(dir, { recursive: true });
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const [a, b] = [before.get(path) ?? "", after.get(path) ?? ""];
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
