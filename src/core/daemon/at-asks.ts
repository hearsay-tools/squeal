import { selects } from "../commit/at-keys-narrow.js";
import { testFileId } from "../keys/reverse-index.js";
import type {
  CommitAskRequest,
  CommitAskState,
  CommitSetup,
  CommitSnapshot,
} from "../types/commit-ask.js";
import type { RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { NarrowRunOptions } from "../types/scheduler.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c, the human: "A: daemon
 * owns setup"): a commit daemon's `status --at --run` asks. An ask is
 * answered at once and kept; once the daemon's start settled (its install,
 * then its keys), the files with no result at their live key that the
 * change selects (D4.5, from the key index: `changedSelects`) or the call
 * names are queued as narrow runs of the call's owner, the named files
 * first and leading. At each change the socket thread gets a snapshot of
 * the setup and the asks (`changed`), which it answers reads from
 * (`CommitDesk`).
 */

/** Asks kept for reads; older ones are dropped. */
const MAX_ASKS = 32;

/** What a commit daemon gives its asks. */
export interface AtAskPorts {
  readonly setup: () => CommitSetup;
  /** Settles once the daemon's start did (install, keys), whether it served or failed. */
  readonly started: () => Promise<void>;
  /** The test files `paths` select from the key index (`Scheduler.changedSelects`); `null`: no scheduler. */
  readonly changedSelects: (
    paths: readonly RelativePath[],
  ) => Promise<readonly TestFileRef[] | null>;
  /** The daemon's rows: each test file with its live key and pending mark; with `files`, theirs. */
  readonly rows: (files?: readonly TestFileRef[]) => readonly AtRow[];
  /** Whether a result of `ref` is stored at `key`. */
  readonly stored: (ref: TestFileRef, key: CheckKey) => boolean;
  /** The group `ref` runs in, by the policy in force. */
  readonly groupOf: (ref: TestFileRef) => string;
  /** A narrow run of `paths` of `group` (the daemon's `run-group-paths`); rejects with why not. */
  readonly request: (
    group: string,
    paths: readonly RelativePath[],
    options: NarrowRunOptions,
  ) => Promise<unknown>;
  /** The setup or an ask changed: the socket thread gets `AtAsks.snapshot()`. */
  readonly changed: () => void;
}

/** A row of the daemon's keys, as `TestFileKeyRecord` holds it. */
export interface AtRow {
  readonly testFile: TestFileRef;
  readonly key: CheckKey | null;
  readonly pending: "queued" | "running" | null;
}

interface Kept {
  readonly owner: string;
  phase: CommitAskState["phase"];
  text?: string;
  files: TestFileRef[];
  readers: Record<RelativePath, readonly TestFileRef[]>;
  problems: string[];
}

/** The asks of one commit daemon. */
export class AtAsks {
  readonly #asks = new Map<string, Kept>();

  constructor(private readonly ports: AtAskPorts) {}

  /** Keeps the ask and starts its selection; an owner asked again is left as it stands. */
  ask(request: CommitAskRequest): void {
    if (this.#asks.has(request.owner)) return;
    const kept: Kept = {
      owner: request.owner,
      phase: "waiting",
      files: [],
      readers: {},
      problems: [],
    };
    this.#asks.set(request.owner, kept);
    while (this.#asks.size > MAX_ASKS) this.#asks.delete(this.#asks.keys().next().value as string);
    this.ports.changed();
    void this.#take(request, kept)
      .catch((error: unknown) => {
        kept.phase = "failed";
        kept.text = error instanceof Error ? error.message : String(error);
      })
      .finally(() => this.ports.changed());
  }

  /** The setup and every kept ask, for the socket thread. */
  snapshot(): CommitSnapshot {
    const setup = this.ports.setup();
    return { setup, asks: [...this.#asks.values()].map((ask) => stateOf(ask, setup)) };
  }

  async #take(request: CommitAskRequest, kept: Kept): Promise<void> {
    await this.ports.started();
    const setup = this.ports.setup();
    if (setup.phase === "failed") {
      kept.phase = "failed";
      kept.text = setup.text;
      return;
    }
    kept.phase = "selecting";
    this.ports.changed();
    const chosen = await choose(request, this.ports);
    if (chosen === null) {
      kept.phase = "failed";
      kept.text = "the daemon is not running a scheduler";
      return;
    }
    kept.readers = chosen.readers;
    kept.files = [...chosen.named, ...chosen.rest];
    const options = { owner: request.owner, at: true } as const;
    await this.#queue(chosen.named, { ...options, lead: true }, kept);
    await this.#queue(chosen.rest, options, kept);
    kept.phase = "queued";
  }

  /** One narrow run per group; a group whose request fails says so. */
  async #queue(refs: readonly TestFileRef[], options: NarrowRunOptions, kept: Kept): Promise<void> {
    const byGroup = new Map<string, Set<RelativePath>>();
    for (const ref of refs) {
      const group = this.ports.groupOf(ref);
      byGroup.set(group, (byGroup.get(group) ?? new Set()).add(ref.path));
    }
    for (const [group, paths] of byGroup) {
      try {
        await this.ports.request(group, [...paths], options);
      } catch (error) {
        kept.problems.push(
          `group ${group}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

function stateOf(ask: Kept, setup: CommitSetup): CommitAskState {
  const phase = ask.phase === "waiting" && setup.phase === "ready" ? "selecting" : ask.phase;
  return {
    owner: ask.owner,
    phase,
    ...(ask.text === undefined ? {} : { text: ask.text }),
    files: [...ask.files],
    readers: { ...ask.readers },
    problems: [...ask.problems],
  };
}

/** What one ask runs: the named files, the rest, and the readers of named paths that are no test file. */
interface Chosen {
  readonly named: readonly TestFileRef[];
  readonly rest: readonly TestFileRef[];
  readonly readers: Record<RelativePath, readonly TestFileRef[]>;
}

/**
 * D4.5 at the commit: of the files with no result at their live key, the
 * ones the call names (a named path that is no test file names the files
 * that read it), then the ones the change selects (and each with no key),
 * or every one with `--all-missing`. `null` when no scheduler serves.
 */
export async function choose(request: CommitAskRequest, ports: AtAskPorts): Promise<Chosen | null> {
  const rows = ports.rows();
  const changed = request.allMissing ? [] : await ports.changedSelects(request.changed);
  if (changed === null) return null;
  const named = new Set<string>();
  const readers: Record<RelativePath, readonly TestFileRef[]> = {};
  for (const path of request.named) {
    const own = rows.filter((row) => selects([path], row.testFile.path));
    if (own.length > 0) {
      for (const row of own) named.add(testFileId(row.testFile));
      continue;
    }
    const read = (await ports.changedSelects([path])) ?? [];
    readers[path] = read;
    for (const ref of read) named.add(testFileId(ref));
  }
  const selected = new Set(changed.map(testFileId));
  const missing = rows.filter((row) => row.key === null || !ports.stored(row.testFile, row.key));
  const first: TestFileRef[] = [];
  const rest: TestFileRef[] = [];
  for (const { testFile, key } of missing) {
    const id = testFileId(testFile);
    if (named.has(id)) first.push(testFile);
    // 023-46's seam: a file with no key is in no closure index, so it is selected, never unaffected.
    else if (request.allMissing || selected.has(id) || key === null) rest.push(testFile);
  }
  return { named: first, rest, readers };
}
