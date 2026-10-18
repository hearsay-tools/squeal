import { PRECONDITION_TIMEOUT_MS } from "../../core/daemon/policy-precondition.js";
import type { Policy, SlowPrecondition } from "../../core/types/index.js";

/** A declared precondition command, as `squeal setup --plan` names it (row 004-68). */
export interface PreconditionCommand {
  /** `slow.precondition`, or `nodeTest "<name>" precondition`, as a skip's reason names it. */
  readonly source: string;
  readonly command: readonly string[];
  /** The declared `timeoutMs`, else the default. */
  readonly timeoutMs: number;
}

/**
 * Spec 004 D7 as amended 2026-10-17: a command precondition is code Squeal
 * runs beside the runner, so the plan lists each declared one, as visibly as
 * `nodeTest[].argv`. An `exists`-only precondition runs nothing and is not listed.
 */
export function preconditionCommands(policy: Policy): PreconditionCommand[] {
  const declared: [string, SlowPrecondition | undefined][] = [
    ["slow.precondition", policy.slow.precondition],
    ...policy.nodeTest.map(
      (p) =>
        [`nodeTest ${JSON.stringify(p.name)} precondition`, p.precondition] as [
          string,
          SlowPrecondition | undefined,
        ],
    ),
  ];
  return declared.flatMap(([source, precondition]) =>
    precondition?.command === undefined
      ? []
      : [
          {
            source,
            command: precondition.command,
            timeoutMs: precondition.timeoutMs ?? PRECONDITION_TIMEOUT_MS,
          },
        ],
  );
}
