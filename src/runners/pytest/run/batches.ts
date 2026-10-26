import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbsolutePath, RunEnd, RunReport, TestFileRef } from "../../../core/types/index.js";
import type { ProcessExit } from "../../process/group.js";
import { runLogJson } from "../../run-summary.js";
import type { ImportEvent, SpawnedEvent, WrittenEvent } from "./events.js";
import type { BatchFile, BatchReport } from "./report.js";

/** What `ending` reads of the tier. */
export interface TierFacts {
  readonly total: number;
  readonly timeoutMs: number | null;
  readonly python: string;
  readonly logDir: AbsolutePath;
}

/** One pytest process of a tier (spec 007 D6). */
export interface Batch {
  readonly index: number;
  readonly files: readonly BatchFile[];
  readonly args: readonly string[];
  exit: ProcessExit | null;
  /** A stop or the deadline signalled the process while it ran (row 011-232). */
  signalled: boolean;
  read: BatchReport | null;
  /**
   * The plugin's import edges, its children's `spawned` records and the run's
   * `written` directories (016 D4), read with `read`.
   */
  edges: readonly (ImportEvent | SpawnedEvent | WrittenEvent)[];
}

/** The tier in batches of `size`, in the order given; a file `alone` names gets one of its own. */
export function split(
  files: readonly TestFileRef[],
  size: number,
  alone?: (testFile: TestFileRef) => boolean,
): TestFileRef[][] {
  const batches: TestFileRef[][] = [];
  let open: TestFileRef[] = [];
  for (const file of files) {
    if (alone?.(file) === true) batches.push([file]);
    else {
      open.push(file);
      if (open.length === Math.max(1, size)) {
        batches.push(open);
        open = [];
      }
    }
  }
  if (open.length > 0) batches.push(open);
  return batches;
}

/**
 * `timed-out` when the deadline passed; `completed` when every file
 * completed; otherwise `completed` naming the unfinished files when some
 * completed, `crashed` when none did.
 */
export function ending(
  batches: readonly Batch[],
  done: ReadonlySet<TestFileRef>,
  expired: boolean,
  tier: TierFacts,
): { end: RunEnd; failure: string | null } {
  const unfinished = batches.filter((b) => b.files.some((f) => !done.has(f.testFile)));
  const total = tier.total;
  if (expired) {
    const count = total - done.size;
    return {
      end: "timed-out",
      failure: `deadline of ${tier.timeoutMs} ms passed with ${count} of ${total} test files unfinished`,
    };
  }
  if (unfinished.length === 0) return { end: "completed", failure: null };
  const what = unfinished
    .map((b) => `${names(b, (f) => !done.has(f.testFile))} (${describeExit(b, tier)})`)
    .join(", ");
  const failure = `pytest ended without a complete report for ${what}`;
  return { end: done.size === 0 ? "crashed" : "completed", failure };
}

export function names(batch: Batch, keep: (file: BatchFile) => boolean = () => true): string {
  return batch.files
    .filter(keep)
    .map((f) => f.testFile.path)
    .join(", ");
}

function describeExit(batch: Batch, tier: TierFacts): string {
  const exit = batch.exit;
  if (exit === null) return "not started";
  if (exit.error !== null) return `cannot run ${tier.python}: ${exit.error}`;
  const how = exit.signal === null ? `exit code ${exit.code}` : `signal ${exit.signal}`;
  const tail = readOr(join(tier.logDir, `stderr-${batch.index}.log`))
    .trim()
    .split("\n")
    .slice(-3);
  return tail[0] === "" ? how : `${how}: ${tail.join(" | ")}`;
}

export function realOr(path: string): AbsolutePath {
  try {
    return realpathSync(path) as AbsolutePath;
  } catch {
    return path as AbsolutePath;
  }
}

export function readOr(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** `run.json`: each batch's command line and exit, which nothing trusts for a verdict (D6), the run's summary and notes. */
export function writeRunLog(
  logDir: AbsolutePath,
  log: {
    python: string;
    cwd: string;
    batches: readonly Batch[];
    report: RunReport;
    notes: readonly string[];
  },
): void {
  const batches = log.batches.map((b) => ({
    files: b.files.map((f) => f.testFile.path),
    command: [log.python, ...b.args],
    exit: b.exit,
    signalled: b.signalled,
    session: b.read?.session ?? false,
  }));
  const text = runLogJson({ cwd: log.cwd, batches, notes: log.notes }, log.report);
  writeFileSync(join(logDir, "run.json"), text);
}
