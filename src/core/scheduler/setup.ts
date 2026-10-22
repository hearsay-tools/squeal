import { testFileId } from "../keys/index.js";
import { checkIdentity } from "../state/derive.js";
import type {
  CheckError,
  CommitSha,
  KnownState,
  ProjectName,
  SetupCheckId,
  SetupOutcome,
  StartupFailure,
} from "../types/index.js";
import { NOTHING_CHANGED } from "./context.js";
import { block, type Failures, failed } from "./failures.js";
import type { FileState } from "./files.js";
import type { MergeHold } from "./hold.js";
import type { Ledger } from "./ledger.js";
import { priorityOf } from "./queue.js";

/*
 * Task 001-382, research cezar-e2e-setup: a run that failed to start (a
 * `globalSetup` that threw) is one known failure, its project's `setup`
 * check, never a FAIL of each file it kept from running. It is a known state
 * of this worktree only: it has no key, so nothing is stored under one (D8),
 * and a later run of the project that starts makes it `pass`.
 */

/** The failing setup checks of the worktree, and the outcomes owed to the sink. */
export class SetupFailures {
  readonly #failing = new Map<string, SetupCheckId>();
  #owed: SetupOutcome[] = [];

  /** Takes in the failing setup checks a previous daemon left (bootstrap). */
  restore(states: readonly KnownState[]): void {
    for (const { check, outcome } of states) {
      if (check.kind === "setup" && outcome === "fail") {
        this.#failing.set(checkIdentity(check), check);
      }
    }
  }

  fail(check: SetupCheckId, error: CheckError, commit: CommitSha | null): void {
    this.#failing.set(checkIdentity(check), check);
    this.#owed.push({ check, commit, error });
  }

  /** A run of `projects` started: their failing setups pass. */
  pass(projects: ReadonlySet<ProjectName>, commit: CommitSha | null): void {
    for (const [id, check] of this.#failing) {
      if (!projects.has(check.project)) continue;
      this.#failing.delete(id);
      this.#owed.push({ check, commit, error: null });
    }
  }

  /** The outcomes owed to the sink since the last commit. */
  take(): SetupOutcome[] {
    return this.#owed.splice(0);
  }
}

/** Why the files of a project whose run failed to start are `unknown`. */
export function notStartedReason(startup: StartupFailure): string {
  return startup.setupFile === null
    ? "not run: the run failed to start"
    : `not run: global setup ${startup.setupFile} failed`;
}

/**
 * A tier's run failed to start (`RunReport.startupFailure`). The files of its
 * projects that were to run become `unknown` through D5's runner-failure
 * path (`block`), so none runs again before the next revision or `run --all`
 * (`Ledger.broken`), which starts a new instance and the setup with it. A
 * file of the tier in another project runs again. Each project's setup
 * check fails with the error.
 */
export function failStartup(
  ledger: Ledger,
  startup: StartupFailure,
  notStarted: readonly { readonly file: FileState; readonly forced: boolean }[],
  commit: CommitSha | null,
): void {
  const projects = failedProjects(startup, notStarted);
  const inTier = new Set(notStarted.map(({ file }) => file.id));
  for (const { file, forced } of notStarted) {
    if (projects.has(file.ref.project) || file.key === null || file.blocked !== null) continue;
    ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), forced);
  }
  const failures: Failures = new Map();
  for (const project of projects) failed(failures, project, notStartedReason(startup));
  // A forced file stays queued through `block`; here it would start the failing setup again.
  const waiting = (file: FileState) => inTier.has(file.id) || ledger.queue.has(file.ref);
  for (const file of block(ledger, failures, waiting, "setup")) ledger.queue.remove(file.ref);
  for (const project of projects) {
    const check = { kind: "setup", project, testPath: startup.setupFile ?? "" } as const;
    ledger.setups.fail(check, startup.error, commit);
  }
}

/** What a run recorded while the merge hold holds gives of its setups (`heldSetups`). */
export interface HeldSetups<T> {
  /** The projects whose setup outcome, pass or fail, the run gives none. */
  readonly projects: ReadonlySet<ProjectName>;
  /** The run's startup failure blames one of them: it fails no setup and blocks no file. */
  readonly startup: boolean;
  /** The files that failure kept from starting: queued again, uncounted. */
  readonly notStarted: readonly T[];
}

/**
 * Review 0.1.266, B2 (011 C9): a run the merge hold let past gives no setup
 * outcome for a project whose setup may have read an unmerged path: the
 * projects of the files `held` names, whose keys name one through their
 * closure or their project's environment inputs (where a global setup and
 * its closure are listed), and, when the setup file is unmerged itself,
 * those its startup failure blames (`failedProjects`). A startup failure
 * that blames one of them is the hold's: the files it kept from starting
 * stay queued at their keys and none is `unknown`. Outside the hold, none.
 */
export function heldSetups<T extends { readonly file: FileState }>(
  hold: Pick<MergeHold, "holding" | "names">,
  files: readonly T[],
  held: readonly T[],
  startup: StartupFailure | undefined,
): HeldSetups<T> {
  const projects = new Set(held.map(({ file }) => file.ref.project));
  if (!hold.holding || startup === undefined) return { projects, startup: false, notStarted: [] };
  const listed = new Set(startup.testFiles.map(testFileId));
  const kept = files.filter(({ file }) => listed.has(file.id));
  const blamed = failedProjects(startup, kept);
  const unmerged = startup.setupFile !== null && hold.names([startup.setupFile]);
  if (!unmerged && ![...blamed].some((project) => projects.has(project))) {
    return { projects, startup: false, notStarted: [] };
  }
  for (const project of blamed) projects.add(project);
  return { projects, startup: true, notStarted: kept };
}

/**
 * The projects of the tier the failure names; every project of the tier when
 * it names none of them (review wave-13bp B3). A failure blamed on a project
 * outside the run would queue the run's own files again, and their new
 * instance would start the failing setup at once, at the same revision.
 */
function failedProjects(
  startup: StartupFailure,
  notStarted: readonly { readonly file: FileState }[],
): Set<ProjectName> {
  const tier = new Set(notStarted.map(({ file }) => file.ref.project));
  const named = startup.projects.filter((project) => tier.has(project));
  if (named.length > 0) return new Set(named);
  return tier.size > 0 ? tier : new Set(startup.projects);
}
