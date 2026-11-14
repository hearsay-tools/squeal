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
 * Spec 020 D17.5 as amended by row 020-59 (#201, #216; the parent's
 * choice C2 after the measurement in `tasks/wave-22-020-59/notes.md`): a
 * runner whose stored estimate is long runs its files in chunks, one run
 * after another, so the keeper hears each chunk's completed files when
 * that chunk ends and writes them while the next chunk runs; a gate killed
 * later keeps them. Each chunk holds at least `CHUNK_SECONDS` of estimated
 * work, and a runner is split only when its estimate covers at least two
 * chunks. A run costs about 6.4 s whatever its file count (the
 * measurement), so a chunk that long costs about 2 percent; and a killed
 * long gate loses at most about that much work. A runner with no stored
 * duration, or a shorter estimate, runs in one run, as before.
 */

/**
 * The policy: the least estimated work in one chunk, in seconds; the work a
 * killed long gate may lose, at about 2 percent of run overhead.
 */
export const CHUNK_SECONDS = 300;

/**
 * Vitest's own width for a project that sets no `maxWorkers`, outside watch
 * mode: one worker per CPU but one (Vitest's `resolveMaxWorkers`), as the
 * estimate reads it (`plan.ts`).
 */
const vitestWidth = () => Math.max(1, availableParallelism() - 1);

/**
 * `files` of `pick`'s run, in their order, in chunks. With `chunkFiles`, of
 * that many files each. Else by estimated work: each file at its stored
 * seconds (`durations`), one with none at the median of the stored ones,
 * over the widest width its files run at, as the estimate reads it
 * (Vitest's from the CPU count, node:test's `tierSize`). A chunk closes
 * once it holds `seconds` of work; a last chunk below it joins the one
 * before. One chunk when no file has a stored duration, or when the whole
 * run's work is below twice `seconds`.
 */
export function chunksFor(
  pick: Pick<Picked, "kind" | "adapter">,
  files: readonly TestFileRef[],
  at: {
    readonly tierSize: number;
    readonly durations?: ((ref: TestFileRef) => number | null) | undefined;
    readonly chunkFiles?: number | undefined;
    readonly seconds?: number;
  },
): TestFileRef[][] {
  if (at.chunkFiles !== undefined) return chunksOf(files, Math.max(1, Math.floor(at.chunkFiles)));
  const bound = at.seconds ?? CHUNK_SECONDS;
  const stored = files.map((ref) => at.durations?.(ref) ?? null);
  const known = stored.filter((s): s is number => s !== null).sort((a, b) => a - b);
  if (known.length === 0) return [[...files]];
  const median = known[Math.floor(known.length / 2)] ?? 0;
  const grant = pick.kind === "vitest" ? vitestWidth() : at.tierSize;
  const width = Math.max(1, ...files.map((ref) => pick.adapter.traits.tierWidth(ref, grant)));
  const work = stored.map((s) => (s ?? median) / width);
  if (work.reduce((sum, w) => sum + w, 0) < 2 * bound) return [[...files]];
  const chunks: TestFileRef[][] = [];
  let chunk: TestFileRef[] = [];
  let held = 0;
  files.forEach((ref, i) => {
    chunk.push(ref);
    held += work[i] ?? 0;
    if (held < bound) return;
    chunks.push(chunk);
    chunk = [];
    held = 0;
  });
  if (chunk.length > 0) {
    const last = chunks.pop();
    chunks.push(last === undefined ? chunk : [...last, ...chunk]);
  }
  return chunks;
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
