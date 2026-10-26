import type { NamedFile } from "../../src/cli/named-files.js";
import type { SyncState } from "../../src/cli/status-sync.js";
import type { EndedNamed } from "../../src/cli/status-wait-lines.js";
import type { FileVerdict } from "../../src/cli/verdict.js";
import type { RevisionNumber, StatusSnapshot } from "../../src/core/types/index.js";
import { settled } from "../evals/status-snapshot.js";
import { ref } from "./status-wait-fixture.js";

/*
 * Row 011-243 (gh-99): named waits with no verdict, built as a wait returns
 * them, for the line tests and the evals parser gate.
 */

/** #99's selection: nine contract-parity and typed-bodies test files, each current and passing. */
export const NINE = [
  ...["automations", "delegation", "github", "runs", "", "voice", "workflows", "workspace"].map(
    (part) => `packages/cezar/src/server/contract-parity${part === "" ? "" : `.${part}`}.test.ts`,
  ),
  "packages/cezar/src/server/typed-bodies.test.ts",
];

export const SYNCED = (revision: number): SyncState => ({
  state: "synced",
  revision: revision as RevisionNumber,
  incarnation: null,
});

/** A named wait on `paths` that ended `outcome` at `revision`, each file current and passing. */
export function ended(
  paths: readonly string[],
  outcome: EndedNamed["outcome"],
  revision: number,
  overrides: { result?: Partial<StatusSnapshot>; verdict?: Partial<FileVerdict> } & Partial<
    Omit<EndedNamed, "result" | "verdict">
  > = {},
): EndedNamed {
  const files = paths.map(ref);
  const { result, verdict, ...rest } = overrides;
  return {
    outcome,
    waitedMs: 61_200,
    selection: {
      files,
      unmatched: [],
      paths: paths.map((path) => ({ path, kind: "test-file", selects: 1 })),
      base: "",
    },
    verdict: {
      revision: revision as RevisionNumber,
      testFiles: paths.length,
      byClass: { current: paths.length, pending: 0, stale: 0, unknown: 0 },
      unlisted: false,
      failures: { tests: 0, testFiles: 0 },
      ...verdict,
    },
    files: files.map((testFile): NamedFile => ({ testFile, state: "current", verdict: "pass" })),
    sync: SYNCED(revision),
    result: { ...settled, revision, refinedRevision: revision, ...result },
    timeoutMs: 60_000,
    ...rest,
  } as EndedNamed;
}

/** #99: passes at revision 6, revision 7 not listed after a branch switch, 677 files queued. */
export const ISSUE_99 = ended(NINE, "timeout", 7, {
  verdict: { unlisted: true },
  result: {
    refinedRevision: 6,
    runnerPartPending: true,
    testFileCounts: { current: 349, pending: 677, stale: 0, unknown: 0 },
    testFilesByPhase: { running: 0, queued: 677 },
  },
});
