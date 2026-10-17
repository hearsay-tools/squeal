// Types for apply-issue-intake.cjs, so the Vitest suite can import it.

export interface Intake {
  action: "duplicate" | "label" | "skip";
  duplicate_of: number | null;
  comment: string | null;
  labels: string[];
}

export function validateIntake(intake: unknown): asserts intake is Intake;
export function loadIntake(input: unknown): Intake;
export function planIntakeMutations(input: {
  intake: unknown;
  issueNumber: number;
  knownLabels: unknown;
  candidateOpen: unknown;
  closeDuplicates: unknown;
  warn?: (message: string) => void;
}): string[][];
export const CLOSE_VARIABLE: string;
