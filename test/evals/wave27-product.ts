import { readFileSync } from "node:fs";
import { formatDelta } from "../../src/core/delivery/index.js";
import type { Delta, TransitionEntry } from "../../src/core/types/index.js";

// Review 006-18 (reviews/wave-2.6.md): Squeal's deliveries as the product's own `formatDelta`
// words them, and the real runner output the review's controls printed, captured from Vitest
// 5.0.3 and node:test on a scratch copy of evals/ledgerline (`wave27-runner-output/`).

/** One changed check: its test file, its name, and how it changed. */
export interface Change {
  path: string;
  name: string;
  kind: TransitionEntry["kind"];
  from: TransitionEntry["from"];
  to: TransitionEntry["to"];
  validity?: TransitionEntry["validity"];
  observedAt?: number;
}

/**
 * A delivery at `revision` of `changes`, with `pending` other checks still pending; the header
 * also counts each change that is itself pending or stale.
 */
export function delivered(revision: number, changes: Change[], pending = 0): string {
  const n = (v: TransitionEntry["validity"]) => changes.filter((c) => c.validity === v).length;
  const stale = n("stale");
  pending += n("pending");
  const delta: Delta = {
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header: {
      revision,
      counts: { current: 31 - pending - stale, pending, stale, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
    },
    label: "transitions",
    entries: changes.map((c) => ({
      check: { kind: "test", project: "", testPath: c.path, fullName: c.name },
      kind: c.kind,
      from: c.from,
      to: c.to,
      validity: c.validity ?? "current",
      observedAt: c.observedAt ?? revision,
      origin: { kind: "own" },
      summary: null,
      location: null,
    })) as Delta["entries"],
  } as Delta;
  return formatDelta(delta);
}

export const MONEY = { path: "test/money.test.ts", name: "money > formats thousands" };
export const REPORT = { path: "test/report.test.ts", name: "report > totals" };
export const FAILS = { kind: "first-seen-fail", from: null, to: "fail" } as const;
export const REGRESSES = { kind: "pass-to-fail", from: "pass", to: "fail" } as const;
export const CHANGES = { kind: "fail-changed", from: "fail", to: "fail" } as const;
export const RECOVERS = { kind: "fail-to-pass", from: "fail", to: "pass" } as const;

/** What a control printed, under `wave27-runner-output/`. */
export const output = (name: string) =>
  readFileSync(new URL(`./wave27-runner-output/${name}.txt`, import.meta.url), "utf8");
