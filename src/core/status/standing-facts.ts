import type { KnownState, ProjectName, UnknownTestFile } from "../types/index.js";
import type { KnownSetup, LoadNow, Standing } from "./next-step.js";

/*
 * Row 011-27 (011 C15 as amended 2026-10-20): what `readNamedFiles` needs
 * beyond a file's own rows to say what advances it.
 */

/** What the store and host say beyond a file's own rows (`unknownStanding`). */
export interface Facts {
  readonly lookupOnly: boolean;
  readonly installCommand: string | null;
  readonly load: () => LoadNow;
  /** The worktree's test files not current. */
  readonly notCurrent: () => number;
}

/**
 * An `unknown` file's standing from its structured cause (row 011-27), so a
 * timeout is not matched by its words; a record without one, from a daemon
 * before it, or a cause with no step of its own runs once on `retry`.
 */
export function unknownStanding(unknown: UnknownTestFile, facts: Facts): Standing {
  const reason = unknown.reason ?? "no reason was kept";
  switch (unknown.cause) {
    case "timeout":
      return { kind: "timed-out", reason, load: facts.load(), notCurrent: facts.notCurrent() };
    case "install":
      return { kind: "no-install", command: facts.installCommand };
    case "runner":
      return { kind: "runner", reason };
    case "setup":
      return { kind: "setup-failed" };
    case "never-run":
      return { kind: "never-run", lookupOnly: facts.lookupOnly, notCurrent: facts.notCurrent() };
    default:
      return {
        kind: "no-result",
        reason: `${unknown.ran ? "ran, nothing recorded" : "no result"}: ${reason}`,
        notCurrent: facts.notCurrent(),
      };
  }
}

/**
 * Each project's global setup the store knows of, by its setup check (task
 * 001-382), which exists once a run of it failed in this worktree: the store
 * keeps no project's global setup files otherwise (row 011-27's probe).
 */
export function setupsOf(states: readonly KnownState[]): ReadonlyMap<ProjectName, KnownSetup> {
  const setups = new Map<ProjectName, KnownSetup>();
  for (const s of states) {
    if (s.check.kind === "setup") setups.set(s.check.project, { file: s.check.testPath });
  }
  return setups;
}

/** `read`, called at most once. */
export function once<T>(read: () => T): () => T {
  let value: { readonly v: T } | undefined;
  return () => {
    value ??= { v: read() };
    return value.v;
  };
}
