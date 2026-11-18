import { testFileId } from "../core/keys/reverse-index.js";
import { type Conditions, hasConditions } from "../core/proof/conditions.js";
import { notRunWhy, redOnAssertion, verdictOf, withControl } from "../core/proof/verdict.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { ProofFile, ProofReport } from "./proof-report.js";
import type { SideAnswer, SideFile } from "./proof-side.js";

/*
 * Spec 023 D5.5 (row 023-08): a proof's files from its sides' answers,
 * with the runs and checkout times. Row 023-20: why a side did not run
 * (lessons P7), and the red side's control run without the conditions
 * (P9).
 */

/** The proof's files and counts from its sides' answers; red and control `null` when not made. */
export function provedFiles(
  green: SideAnswer,
  red: SideAnswer | null,
  control: SideAnswer | null,
  conditions: Conditions,
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
    files: green.refs.map((ref) =>
      fileOf(ref, green.files, red?.files, control?.files, conditioned),
    ),
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
): ProofFile {
  const greenFile = endOf(green, ref);
  const redFile = red?.has(testFileId(ref)) === true ? endOf(red, ref) : greenFile;
  const decides = redOnAssertion(redFile.end);
  const controlFile = control?.has(testFileId(ref)) === true ? endOf(control, ref) : null;
  const { verdict, reason } = withControl(
    verdictOf(redFile.end, decides ? greenFile.end : null),
    controlFile?.end ?? null,
  );
  const shown = decides || greenFile.from !== null ? greenFile : null;
  // Row 023-20 (P7): a side not run says why.
  const why = notRunWhy(redFile.end);
  return {
    ref,
    verdict,
    reason,
    red: redFile,
    green: shown,
    greenNotRun: shown === null ? why : null,
    control: controlFile,
    controlNotRun: conditioned && controlFile === null ? why : null,
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
