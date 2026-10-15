import type { Evidence } from "../../../evals/lib/index.mjs";

export function squealEvidence(
  text: string,
  from: "push" | "pull",
  failures?: number,
): Evidence | null;
