import { testFileId } from "../core/keys/reverse-index.js";
import { type Conditions, hasConditions } from "../core/proof/conditions.js";
import { type ChangedImports, stops } from "../core/proof/imports.js";
import {
  notRunWhy,
  redCounts,
  redEvidence,
  verdictOf,
  withControl,
} from "../core/proof/verdict.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { ProofFile, ProofReport } from "./proof-report.js";
import type { SideAnswer, SideFile } from "./proof-side.js";

/*
 * Spec 023 D5.5 (row 023-08): a proof's files from its sides' answers,
 * with the runs and checkout times. Row 023-20: why a side did not run
 * (lessons P7), and the red side's control run without the conditions
 * (P9). Row 023-21 (D5.2, issue #247): an unchanged named test whose
 * changed imports Squeal did not settle as product code runs nothing and
 * reads not comparable.
 */

/** Row 023-21: each named file's changed imports while it is unchanged, by `testFileId`. */
export type ImportsOf = ReadonlyMap<string, ChangedImports | null>;

/** The proof's files and counts from its sides' answers; red and control `null` when not made. */
export function provedFiles(
  green: SideAnswer,
  red: SideAnswer | null,
  control: SideAnswer | null,
  conditions: Conditions,
  imports: ImportsOf,
  base: string,
  redErrors: readonly string[] = [],
): Pick<ProofReport, "runs" | "checkoutMs" | "files"> {
  const conditioned = hasConditions(conditions);
  const redMs = red?.checkoutMs ?? null;
  const controlMs = control?.checkoutMs ?? null;
  return {
    runs: (red?.ran ?? 0) + (control?.ran ?? 0) + green.ran,
    // The red side's and control's checkouts lie within the green side's: green's own time is the rest.
    checkoutMs: {
      red: redMs,
      control: controlMs,
      green: green.checkoutMs - (redMs ?? 0) - (controlMs ?? 0),
    },
    files: green.refs.map((ref) => {
      const changed = imports.get(testFileId(ref)) ?? null;
      const stopped = stops(changed) ? stoppedSide(changed, base) : null;
      return {
        ...fileOf(ref, green.files, red?.files, control?.files, conditioned, stopped, redErrors),
        imports: changed,
      };
    }),
  };
}

/**
 * One named file's verdict from its sides: the red side, the green side
 * when the red side decides nothing without it, and the control run
 * without the conditions (row 023-20, P9). A file the green side could not
 * key has no red side: its reason stands for both.
 */
function fileOf(
  ref: TestFileRef,
  green: ReadonlyMap<string, SideFile>,
  red: ReadonlyMap<string, SideFile> | undefined,
  control: ReadonlyMap<string, SideFile> | undefined,
  conditioned: boolean,
  /** Row 023-21: the red side of a file that did not run for its unsettled changed imports. */
  stopped: SideFile | null,
  redErrors: readonly string[],
): Omit<ProofFile, "imports"> {
  const greenFile = endOf(green, ref);
  const redFile = stopped ?? (red?.has(testFileId(ref)) === true ? endOf(red, ref) : greenFile);
  const decides = redCounts(redFile.end, redErrors);
  const controlFile = control?.has(testFileId(ref)) === true ? endOf(control, ref) : null;
  const { verdict, reason } = withControl(
    verdictOf(redFile.end, decides ? greenFile.end : null, redErrors),
    controlFile?.end ?? null,
    redErrors,
  );
  const shown = decides || greenFile.from !== null ? greenFile : null;
  // Row 023-20 (P7): a side not run says why.
  const why = notRunWhy(redFile.end);
  return {
    ref,
    verdict,
    reason,
    evidence: redEvidence(redFile.end, redErrors),
    red: redFile,
    green: shown,
    greenNotRun: shown === null ? why : null,
    control: controlFile,
    controlNotRun: conditioned && controlFile === null ? why : null,
  };
}

/**
 * Row 023-21: the red side of an unchanged named test whose code-side
 * changed imports were not settled: not run, its reason naming them.
 */
function stoppedSide(imports: ChangedImports | null, base: string): SideFile {
  const helpers = imports?.unsettled.map((u) => u.path).join(", ") ?? "";
  return {
    end: {
      end: "unknown",
      reason: `the test is unchanged since ${base.slice(0, 9)}; changed imports: ${helpers}`,
    },
    from: null,
    stored: false,
    notStored: null,
    runs: 0,
  };
}

export function endOf(files: ReadonlyMap<string, SideFile>, ref: TestFileRef): SideFile {
  return (
    files.get(testFileId(ref)) ?? {
      end: { end: "unknown", reason: "not keyed" },
      from: null,
      stored: false,
      notStored: null,
      runs: 0,
    }
  );
}
