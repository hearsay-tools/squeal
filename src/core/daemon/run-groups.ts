import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "../fs/json.js";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 023 D4 step 11, D6 (row 023-36, lessons round 5 T3): what a `--run`
 * request's runs in the working tree leave running. A test may start a
 * process in a session and group of its own with an env of its own
 * (squawk's e2e app and its watcher). Each such run gets a token of its own,
 * random, in its workers' env (`RUN_GROUP_VARIABLE`); the recorder's spawn
 * hook puts it in every child's env, the caller's own `env: {}` too
 * (`spawn.cjs`), so the process carries it from its start wherever it is
 * reparented. The daemon records the run's token here before the run
 * starts, so a daemon killed mid-run leaves it for `squeal stop`, and the
 * groups the run's marked processes lead, so a member the stop spares is
 * named. Which processes are stopped is `run-groups-stop.ts`. Never a path
 * or a command line (the human, 2026-11-21).
 */

/** The variable that carries a `--run` run's token in every process of the run. */
export const RUN_GROUP_VARIABLE = "SQUEAL_RUN_GROUP";

/** A group a marked process of a run led when the daemon looked: its id and its leader's start. */
export interface SeenGroup {
  readonly pgid: number;
  readonly start: number;
}

/** A `--run` run whose processes are stopped when it ends. */
export interface RecordedRun {
  /** The run's token, random: only its processes carry it. */
  readonly token: string;
  readonly runId: string;
  /** The groups its marked processes led, for naming a member the stop spares. */
  readonly groups: readonly SeenGroup[];
}

const RECORD_VERSION = 2;

/** The record of the worktree at `root`: `<store dir>/run-groups/<hash of root>.json`. */
export function runGroupsFile(commonDir: AbsolutePath, root: AbsolutePath): AbsolutePath {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(storePaths(commonDir).dir, "run-groups", `${key}.json`);
}

/** The runs in the record at `file`; `[]` when it is missing, of another version, or not a record. */
export function readRuns(file: AbsolutePath): RecordedRun[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(value) || value.v !== RECORD_VERSION || !Array.isArray(value.runs)) return [];
  return value.runs.flatMap((run: unknown) => {
    if (!isRecord(run)) return [];
    const { token, runId, groups } = run;
    if (typeof token !== "string" || token.length < 16 || typeof runId !== "string") return [];
    return [{ token, runId, groups: Array.isArray(groups) ? groups.flatMap(groupOf) : [] }];
  });
}

function groupOf(value: unknown): SeenGroup[] {
  if (!isRecord(value)) return [];
  const { pgid, start } = value;
  if (typeof pgid !== "number" || !Number.isInteger(pgid) || pgid <= 1) return [];
  return typeof start === "number" ? [{ pgid, start }] : [];
}

/** Writes `runs` to `file` by rename; removes the file when there are none. */
export function writeRuns(file: AbsolutePath, runs: readonly RecordedRun[]): void {
  if (runs.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}`;
  writeFileSync(temp, `${JSON.stringify({ v: RECORD_VERSION, runs })}\n`);
  renameSync(temp, file);
}

/** The daemon's record: kept in memory, written through at each change. */
export class RunRecord {
  readonly #file: AbsolutePath;
  #runs: RecordedRun[];

  constructor(file: AbsolutePath) {
    this.#file = file;
    this.#runs = readRuns(file);
  }

  list(): readonly RecordedRun[] {
    return this.#runs;
  }

  add(run: RecordedRun): void {
    if (this.#runs.some(({ token }) => token === run.token)) return;
    this.#runs = [...this.#runs, run];
    this.#write();
  }

  /** Adds `groups` to the run of `token`, those it lacks. */
  saw(token: string, groups: readonly SeenGroup[]): void {
    const run = this.#runs.find((known) => known.token === token);
    if (run === undefined) return;
    const fresh = groups.filter((group) => !run.groups.some((known) => sameGroup(known, group)));
    if (fresh.length === 0) return;
    const next = { ...run, groups: [...run.groups, ...fresh] };
    this.#runs = this.#runs.map((known) => (known === run ? next : known));
    this.#write();
  }

  remove(tokens: readonly string[]): void {
    const kept = this.#runs.filter(({ token }) => !tokens.includes(token));
    if (kept.length === this.#runs.length) return;
    this.#runs = kept;
    this.#write();
  }

  #write(): void {
    try {
      writeRuns(this.#file, this.#runs);
    } catch {
      // A record that cannot be written leaves the stop at the run's end, which reads memory.
    }
  }
}

function sameGroup(a: SeenGroup, b: SeenGroup): boolean {
  return a.pgid === b.pgid && a.start === b.start;
}
