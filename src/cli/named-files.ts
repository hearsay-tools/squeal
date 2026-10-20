/*
 * Row 011-29: the per-file standing a named wait reads moved to
 * `src/core/status/standing.ts`, so status's `Outstanding:` groups derive
 * it too; re-exported here for the CLI's callers.
 */
export {
  type NamedFile,
  type NamedVerdict,
  type PendingReason,
  pauseOnlyIds,
  readNamedFiles,
} from "../core/status/standing.js";
