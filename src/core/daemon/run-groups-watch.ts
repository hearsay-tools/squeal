import { randomUUID } from "node:crypto";
import { testFileId } from "../keys/reverse-index.js";
import type { TestFileRef } from "../types/keys.js";
import type { RunnerAdapter } from "../types/runner.js";
import type { NarrowRunOptions } from "../types/scheduler.js";
import type { RunNote } from "./escaped.js";
import type { GroupRequested } from "./run-group.js";
import { RUN_GROUP_VARIABLE, type RunRecord } from "./run-groups.js";
import { runStopNote, stopRuns, type WorkerRule, workersOf } from "./run-groups-stop.js";

/*
 * Spec 023 D4 step 11 (row 023-36, T3; review wave-20 B7, B8): a run of
 * files an accepted `status --at --run` request selected gets a token of
 * its own in its workers' env (`RUN_GROUP_VARIABLE`), which the recorder's
 * spawn hook carries into every child (`spawn.cjs`). The token is recorded
 * before the run starts; when the run settles, what carries it, and the
 * groups that live carriers lead, are stopped (`stopRuns`) and named.
 * Which runs: those holding a file of a request the scheduler accepted
 * (`AtRunRequests`), by project and path. A request that failed or was
 * refused flags nothing; a taken-back request, or one an hour old, no
 * longer flags. A batch that mixes such a file with others is that
 * request's run: its processes share one env, so the whole run is marked.
 */

/** How long an accepted request flags its files, unless a run ran them or it was taken back. */
export const AT_RUN_TTL_MS = 60 * 60 * 1_000;

/** The files of accepted `--run` requests, by request. */
export class AtRunRequests {
  readonly #requests = new Map<string, { until: number; files: Set<string> }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * The scheduler accepted a request of `id`, its call's owner or its
   * covered-files id, selecting `files`; an owner's requests add up.
   */
  accepted(id: string, files: readonly TestFileRef[]): void {
    if (files.length === 0) return;
    const known = this.#requests.get(id)?.files ?? new Set<string>();
    for (const file of files) known.add(testFileId(file));
    this.#requests.set(id, { until: this.#now() + AT_RUN_TTL_MS, files: known });
  }

  /** The requests of `ids` (owners or covered-files ids) were taken back: they flag nothing more. */
  takenBack(ids: readonly string[]): void {
    for (const id of ids) this.#requests.delete(id);
  }

  flagged(testFiles: readonly TestFileRef[]): boolean {
    const now = this.#now();
    const ids = testFiles.map(testFileId);
    for (const [id, request] of this.#requests) {
      if (request.until <= now) this.#requests.delete(id);
      else if (ids.some((file) => request.files.has(file))) return true;
    }
    return false;
  }

  /** `testFiles` ran: each request flags them no more, and one left with no file goes. */
  ran(testFiles: readonly TestFileRef[]): void {
    const ids = testFiles.map(testFileId);
    for (const [id, request] of this.#requests) {
      for (const file of ids) request.files.delete(file);
      if (request.files.size === 0) this.#requests.delete(id);
    }
  }
}

/**
 * After the scheduler answered a `status --at --run` request (`options.at`): its
 * selected files are flagged under its call's owner (row 023-34), else its
 * covered-files id, which a take-back names, only when it was accepted as a
 * narrow run. A refused or unknown request, or one without `at`, flags
 * nothing.
 */
export function flagAccepted(
  requests: Pick<AtRunRequests, "accepted">,
  requested: Pick<GroupRequested, "narrow" | "coveredId"> | null,
  options: NarrowRunOptions | undefined,
): void {
  if (options?.at !== true || requested?.narrow === undefined) return;
  const id = options.owner ?? requested.coveredId ?? randomUUID();
  requests.accepted(id, requested.narrow.selected);
}

export interface RunGroupsOptions {
  readonly requests: Pick<AtRunRequests, "flagged" | "ran">;
  readonly record: Pick<RunRecord, "add" | "saw" | "remove">;
  readonly note: (note: RunNote) => void;
  /** The run's spare rule for its own workers; `workersOf` the daemon's, read at the stop. */
  readonly workers?: () => WorkerRule;
  /** Stops a run's processes; `stopRuns` but in a test. */
  readonly stop?: typeof stopRuns;
}

/**
 * `runner` with what each flagged run started stopped when it settles,
 * before its report is returned, and named in a note.
 */
export function withRunGroups(runner: RunnerAdapter, options: RunGroupsOptions): RunnerAdapter {
  const stop = options.stop ?? stopRuns;
  const workers = options.workers ?? (() => workersOf());
  const releaseLane = runner.releaseLane?.bind(runner);
  const recheck = runner.recheck?.bind(runner);
  const globalSetups = runner.globalSetups?.bind(runner);
  return {
    name: runner.name,
    adapterVersion: runner.adapterVersion,
    traits: runner.traits,
    invalidate: (paths) => runner.invalidate(paths),
    ...(recheck === undefined ? {} : { recheck }),
    affected: (changedPaths) => runner.affected(changedPaths),
    closure: (testFile) => runner.closure(testFile),
    enumerate: (testFile) => runner.enumerate(testFile),
    testFiles: () => runner.testFiles(),
    ...(globalSetups === undefined ? {} : { globalSetups }),
    environment: () => runner.environment(),
    ...(releaseLane === undefined ? {} : { releaseLane }),
    async run(testFiles, runOptions) {
      if (process.platform !== "linux" || !options.requests.flagged(testFiles))
        return runner.run(testFiles, runOptions);
      const run = { token: randomUUID(), runId: runOptions.runId, groups: [] };
      options.record.add(run);
      const childEnv = { ...runOptions.childEnv, [RUN_GROUP_VARIABLE]: run.token };
      try {
        return await runner.run(testFiles, { ...runOptions, childEnv });
      } finally {
        options.requests.ran(testFiles);
        const result = await stop([run], workers());
        const led = result.groups.get(run.token) ?? [];
        if (led.length > 0) options.record.saw(run.token, led);
        // A member it spared stays recorded, for `squeal stop` to name again.
        if (result.spared.length === 0) options.record.remove([run.token]);
        const note = runStopNote(result);
        if (note !== null) options.note(note);
      }
    },
    close: () => runner.close(),
  };
}
