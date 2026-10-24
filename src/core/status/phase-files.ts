import { testFileId } from "../keys/index.js";
import { fileClassOf, testFileKeyOf } from "../state/index.js";
import { plural, testFileText } from "../text.js";
import type {
  KnownState,
  PendingPhase,
  PendingTestFiles,
  PhaseFiles,
  StatusFocused,
  StatusSnapshot,
  TestFileKeyRecord,
  TestFileRef,
} from "../types/index.js";
import { textsText } from "./focused.js";

/*
 * Row 011-58 (gh-61; 011 C6 and C15): which test files run and which wait,
 * beside the counts of `testFilesByPhase`, so an agent need not guess the
 * long-running file from the tests it counts.
 */

/** How many files of each phase `--json` lists before it counts the rest. */
export const PHASE_FILES_LISTED = 100;

/** How many running files the text names: a tier's width, so usually every one. */
export const RUNNING_FILES_SHOWN = 10;

/** How many queued files the text names before "and N more". */
export const QUEUED_FILES_SHOWN = 5;

/**
 * Each pending test file's phase, by `testFileId`, by the rule
 * `countNotCurrent` counts them with: a file is pending by `fileClassOf`,
 * and running while an open run holds it (`openFiles`, `testFileId`s), its
 * row says so or a check of it runs; else queued. Uncapped, in `keys` order.
 */
export function pendingPhasesOf(
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
  openFiles: ReadonlySet<string>,
): Map<string, { readonly testFile: TestFileRef; readonly phase: PendingPhase }> {
  const checks = new Map<string, KnownState[]>();
  for (const state of states) {
    if (state.check.kind === "setup") continue;
    const id = testFileKeyOf(state.check);
    const own = checks.get(id);
    if (own === undefined) checks.set(id, [state]);
    else own.push(state);
  }
  const phases = new Map<string, { testFile: TestFileRef; phase: PendingPhase }>();
  for (const row of keys) {
    const id = testFileId(row.testFile);
    const own = checks.get(id) ?? [];
    if (fileClassOf(row, own) !== "pending") continue;
    const runs =
      openFiles.has(id) ||
      row.pending === "running" ||
      own.some((s) => s.pendingPhase === "running");
    phases.set(id, { testFile: row.testFile, phase: runs ? "running" : "queued" });
  }
  return phases;
}

/** The pending test files by phase (`pendingPhasesOf`), the first `PHASE_FILES_LISTED` of each. */
export function pendingTestFilesOf(
  phases: ReadonlyMap<string, { readonly testFile: TestFileRef; readonly phase: PendingPhase }>,
): PendingTestFiles {
  const running: TestFileRef[] = [];
  const queued: TestFileRef[] = [];
  for (const { testFile, phase } of phases.values()) {
    (phase === "running" ? running : queued).push(testFile);
  }
  return { running: listed(running), queued: listed(queued) };
}

function listed(files: TestFileRef[]): PhaseFiles {
  const sorted = files.sort((a, b) => testFileId(a).localeCompare(testFileId(b)));
  return {
    files: sorted.slice(0, PHASE_FILES_LISTED),
    omitted: Math.max(0, sorted.length - PHASE_FILES_LISTED),
  };
}

/**
 * `Running: 5 test files: cezar: a.test.ts, ...` and `Queued: ...`, each
 * only when its phase has a file, the project leading each path; a cut one
 * ends `and N more`. None from a payload before the field. Row 011-146 (C6
 * as amended 2026-10-23): a file whose focused run is in flight is named
 * among the running ones with `(focused: <texts>)`, out of the queued text
 * by its phase read before the list's cap (review 0.1.286 B5); only the
 * text moves it, so `pendingTestFiles` and every count are unchanged.
 */
export function phaseLines(s: StatusSnapshot): string[] {
  const pending = s.pendingTestFiles;
  if (pending === undefined) return [];
  const flying = (s.focused ?? []).filter((entry) => entry.applies && entry.endedAt === null);
  const marks = new Map(
    flying.map((e) => [testFileId(e.testFile), ` (focused: ${textsText(e.texts)})`]),
  );
  const listedQueued = new Set(pending.queued.files.map(testFileId));
  // A payload before `phase` moves only a file it names as queued.
  const phaseOf = (e: StatusFocused) =>
    e.phase !== undefined
      ? e.phase
      : listedQueued.has(testFileId(e.testFile))
        ? "queued"
        : "running";
  const moved = flying.filter((e) => phaseOf(e) !== "running").map((e) => e.testFile);
  const movedIds = new Set(moved.map(testFileId));
  // A queued file past the named ones leaves the omitted count.
  const pastNamed = flying.filter(
    (e) => phaseOf(e) === "queued" && !listedQueued.has(testFileId(e.testFile)),
  ).length;
  const running = {
    files: [...moved, ...pending.running.files],
    omitted: pending.running.omitted,
  };
  const queued = {
    files: pending.queued.files.filter((f) => !movedIds.has(testFileId(f))),
    omitted: Math.max(0, pending.queued.omitted - pastNamed),
  };
  return [
    ...phaseLine("Running", running, RUNNING_FILES_SHOWN, marks),
    ...phaseLine("Queued", queued, QUEUED_FILES_SHOWN, marks),
  ];
}

function phaseLine(
  label: string,
  phase: PhaseFiles,
  shown: number,
  marks: ReadonlyMap<string, string>,
): string[] {
  const total = phase.files.length + phase.omitted;
  if (total === 0) return [];
  const names = phase.files
    .slice(0, shown)
    .map((ref) => `${testFileText(ref)}${marks.get(testFileId(ref)) ?? ""}`);
  const more = total - names.length;
  const rest = more > 0 ? ` and ${more} more` : "";
  return [`${label}: ${plural(total, "test file")}: ${names.join(", ")}${rest}`];
}
