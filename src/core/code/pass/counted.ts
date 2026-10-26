import type { CodeCheckId, CodeOutcome, CodeRange, FunctionCount } from "../../types/code.js";
import type { FileHash } from "../../types/index.js";
import type { JudgeInput } from "./judge.js";

/* Spec 015 D3 and D5: each function a work set's counts hold, with its outcome. */

/** A function of a count, as a check with its outcome at the pass's threshold. */
export interface Counted {
  readonly check: CodeCheckId;
  readonly fn: FunctionCount;
  readonly blob: FileHash;
  readonly outcome: CodeOutcome;
}

/** Every function `input`'s counts hold, in file and source order. */
export function countedChecks(input: JudgeInput): Counted[] {
  const out: Counted[] = [];
  for (const file of input.after) {
    if (file.count === null) continue;
    const { blob, functions, errors } = file.count;
    for (const fn of functions) {
      const check: CodeCheckId = {
        kind: "code",
        path: file.path,
        qualifiedName: fn.qualifiedName,
        occurrence: fn.occurrence,
      };
      const outcome: CodeOutcome = errors.some((e) => overlaps(fn.range, e))
        ? "unknown"
        : outcomeAt(fn.complexity, input.threshold);
      out.push({ check, fn, blob, outcome });
    }
  }
  return out;
}

export function outcomeAt(complexity: number, threshold: number): CodeOutcome {
  return complexity > threshold ? "fail" : "pass";
}

/**
 * Whether the error range `b` falls in the function range `a`, both
 * end-exclusive: they share a character. A zero-width error is a missing
 * token's point, and belongs to the function it is in or whose end it
 * touches, as at a missing closing brace; a function that starts at that
 * point is not in it (review 0.1.283 B3).
 */
function overlaps(a: CodeRange, b: CodeRange): boolean {
  if (b.startLine === b.endLine && b.startColumn === b.endColumn) {
    return (
      before(a.startLine, a.startColumn, b.startLine, b.startColumn) &&
      !before(a.endLine, a.endColumn, b.startLine, b.startColumn)
    );
  }
  return (
    before(a.startLine, a.startColumn, b.endLine, b.endColumn) &&
    before(b.startLine, b.startColumn, a.endLine, a.endColumn)
  );
}

function before(line: number, column: number, otherLine: number, otherColumn: number): boolean {
  return line < otherLine || (line === otherLine && column < otherColumn);
}
