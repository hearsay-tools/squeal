import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { extname, join } from "node:path";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import type { RunReport } from "../../types/runner.js";
import type { EndedRun } from "./evidence.js";
import type { Picked } from "./prerun.js";

/*
 * Spec 020 D17.5 as amended by row 020-59 (#201, #216): a runner's files
 * run in chunks, one run after another, so the keeper hears each chunk's
 * completed files when that chunk ends and writes them while the next
 * chunk runs (`Keeper.ran`); a gate killed later keeps them. A chunk holds
 * at most `CHUNK_WIDTHS` times the run's worker width, so each worker
 * takes several files a chunk, and never fewer than `MIN_CHUNK` files. A
 * runner whose files fit in one chunk runs them in one run, as before.
 */

/** How many files per worker one chunk holds. */
export const CHUNK_WIDTHS = 4;

/** The fewest files a chunk holds, whatever the width. */
export const MIN_CHUNK = 8;

/**
 * Vitest's own width for a project that sets no `maxWorkers`, outside watch
 * mode: one worker per CPU but one (Vitest's `resolveMaxWorkers`), as the
 * estimate reads it (`plan.ts`).
 */
const vitestWidth = () => Math.max(1, availableParallelism() - 1);

/**
 * The most files one chunk of `pick`'s run of `files` holds: `CHUNK_WIDTHS`
 * times the widest width its files run at, as the estimate reads it
 * (Vitest's from the CPU count, node:test's `tierSize`), at least
 * `MIN_CHUNK`; `chunkFiles` when given.
 */
export function chunkSize(
  pick: Pick<Picked, "kind" | "adapter">,
  files: readonly TestFileRef[],
  at: { readonly tierSize: number; readonly chunkFiles?: number | undefined },
): number {
  if (at.chunkFiles !== undefined) return Math.max(1, Math.floor(at.chunkFiles));
  if (files.length <= MIN_CHUNK) return MIN_CHUNK;
  const grant = pick.kind === "vitest" ? vitestWidth() : at.tierSize;
  const widths = files.map((ref) => pick.adapter.traits.tierWidth(ref, grant));
  return Math.max(MIN_CHUNK, CHUNK_WIDTHS * Math.max(1, ...widths));
}

/** `files` in chunks of at most `size`, in their order. */
export function chunksOf<T>(files: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < files.length; i += size) chunks.push(files.slice(i, i + size));
  return chunks;
}

/**
 * The runs of one runner's chunks as the log keeper takes them (#197, row
 * 020-40): as they are while at most one of them offers a log; else the
 * offering ones as one run whose folder, `into`, joins theirs in order, a
 * `.log` file of one name appended to the one before, any other file of one
 * name the later chunk's, as a rerun's copy is.
 */
export function joinedLogs(chunks: readonly EndedRun[], into: AbsolutePath): EndedRun[] {
  const offered = chunks.filter(offersLog);
  if (offered.length <= 1) return [...chunks];
  const [first] = offered;
  if (first === undefined) return [];
  for (const run of offered) joinDir(run.logDir, into);
  const reports = offered.flatMap((run) => (run.report === null ? [] : [run.report]));
  return [
    {
      runner: first.runner,
      files: offered.flatMap((run) => run.files),
      logDir: into,
      report: joinedReport(reports),
      ran: offered.flatMap((run) => run.ran),
    },
  ];
}

/** As `keptLogs` reads a run: it started, wrote a folder, and a file of it failed or did not finish. */
function offersLog({ report, logDir, ran }: EndedRun): boolean {
  if (report === null || !existsSync(logDir)) return false;
  return ran.some((file) => !file.completed || file.failed.length > 0);
}

/** `from`'s files copied into `into`, a `.log` already there appended to. */
function joinDir(from: AbsolutePath, into: AbsolutePath): void {
  mkdirSync(into, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(into, entry.name);
    if (entry.isDirectory()) joinDir(source, target);
    else if (extname(entry.name) === ".log" && existsSync(target)) {
      appendFileSync(target, readFileSync(source));
    } else copyFileSync(source, target);
  }
}

/** One report of several chunks' reports, as far as the log keeper reads it. */
function joinedReport(reports: readonly RunReport[]): RunReport {
  return {
    end: reports.find((r) => r.end !== "completed")?.end ?? "completed",
    durationMs: reports.reduce((sum, r) => sum + r.durationMs, 0),
    completedFiles: reports.flatMap((r) => r.completedFiles),
    results: reports.flatMap((r) => r.results),
    fileErrors: reports.flatMap((r) => r.fileErrors),
    failure: reports.find((r) => r.failure !== null)?.failure ?? null,
  };
}
