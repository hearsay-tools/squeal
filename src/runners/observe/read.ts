import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath } from "../../core/types/index.js";

/** What every process of one test file recorded, absolute paths (`recorder.cjs`). */
export interface RecordedFile {
  /** Read, stat'ed, loaded or executed. */
  readonly paths: Set<AbsolutePath>;
  /** Listed. */
  readonly listed: Set<AbsolutePath>;
  /** Listed with `recursive: true`, each in `listed` too (task 001-139). */
  readonly recursive: Set<AbsolutePath>;
  /** Written, created or removed. */
  readonly written: Set<AbsolutePath>;
}

/**
 * Reads every observation file in `dir` and removes it, so the next run reads
 * only its own. Keyed by the test file's absolute path. A partial last line,
 * from a process killed while it wrote, is skipped.
 */
export function takeRecorded(dir: AbsolutePath): Map<AbsolutePath, RecordedFile> {
  const recorded = new Map<AbsolutePath, RecordedFile>();
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".ndjson"));
  } catch {
    return recorded;
  }
  for (const name of names) {
    const file = join(dir, name);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
      rmSync(file, { force: true });
    } catch {
      continue;
    }
    for (const line of text.split("\n")) addLine(recorded, line);
  }
  return recorded;
}

function addLine(recorded: Map<AbsolutePath, RecordedFile>, line: string): void {
  if (line.trim() === "") return;
  let value: { t?: unknown; f?: unknown; l?: unknown; r?: unknown; w?: unknown };
  try {
    value = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof value.t !== "string") return;
  let entry = recorded.get(value.t);
  if (entry === undefined) {
    entry = { paths: new Set(), listed: new Set(), recursive: new Set(), written: new Set() };
    recorded.set(value.t, entry);
  }
  addAll(entry.paths, value.f);
  addAll(entry.listed, value.l);
  addAll(entry.recursive, value.r);
  addAll(entry.written, value.w);
}

function addAll(into: Set<string>, values: unknown): void {
  if (!Array.isArray(values)) return;
  // A virtual module id such as Vite's `\0vite/dynamic-import-helper.js`, joined to a root, is
  // not a file: any fs call on it throws, and it once made every runner call fail.
  for (const value of values)
    if (typeof value === "string" && !value.includes("\0")) into.add(value);
}
