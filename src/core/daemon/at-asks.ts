import { createHash } from "node:crypto";
import { selects } from "../commit/at-keys-narrow.js";
import { changedText } from "../commit/at-keys-walk.js";
import { testFileId } from "../keys/reverse-index.js";
import type {
  CommitAskRequest,
  CommitAskState,
  CommitRefusal,
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
 * first; in a call that names paths every one leads (row 023-50). At each change the socket thread gets a snapshot of
 * the setup and the asks (`changed`), which it answers reads from
 * (`CommitDesk`).
 */

/** Asks kept for reads; older ones are dropped. */
const MAX_ASKS = 32;

/**
 * Review 0.1.599 B4: the identity of an ask's change, its changed paths as a
 * set. The change's selection (`selects`) at one commit depends on that set
 * only, so a caller whose change has the same identity may read the count
 * as its own; another caller's count, or one from before an edit that
 * changed the set, is not.
 */
export function changeOf(changed: readonly RelativePath[]): string {
  const hash = createHash("sha256");
  for (const path of [...new Set(changed)].sort()) hash.update(`${path}\0`);
  return hash.digest("hex").slice(0, 16);
}

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
  /**
   * D4.9: per test file whose closure reads a path git does not hold at the
   * commit and that is there to read (in the tree, or generated in the
   * caller's worktree), that path, by `testFileId`.
   */
  readonly needs: (request: CommitAskRequest) => Promise<ReadonlyMap<string, RelativePath>>;
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
  /** T2: per node:test project, its files with an incomplete static closure; absent: none told. */
  readonly incomplete?: () => Record<string, readonly RelativePath[]>;
}

/** A row of the daemon's keys, as `TestFileKeyRecord` holds it. */
export interface AtRow {
  readonly testFile: TestFileRef;
  readonly key: CheckKey | null;
  readonly pending: "queued" | "running" | null;
}

interface Kept {
  readonly owner: string;
  /** Review 0.1.599 B4: the identity of the ask's change (`changeOf`). */
  readonly change: string;
  phase: CommitAskState["phase"];
  text?: string;
  files: TestFileRef[];
  readers: Record<RelativePath, readonly TestFileRef[]>;
  problems: string[];
  refused: readonly CommitRefusal[];
  /** Row 023-53 (V8): the files the change selects at the commit, before the call's paths narrow them. */
  selects?: number;
}

/** The asks of one commit daemon. */
export class AtAsks {
  readonly #asks = new Map<string, Kept>();

  private readonly ports: AtAskPorts;

  constructor(ports: AtAskPorts) {
    this.ports = ports;
  }

  /** Keeps the ask and starts its selection; an owner asked again is left as it stands. */
  ask(request: CommitAskRequest): void {
    if (this.#asks.has(request.owner)) return;
    const kept: Kept = {
      owner: request.owner,
      change: changeOf(request.changed),
      phase: "waiting",
      files: [],
      readers: {},
      problems: [],
      refused: [],
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
    const incomplete = this.ports.incomplete?.() ?? {};
    return {
      setup,
      asks: [...this.#asks.values()].map((ask) => stateOf(ask, setup)),
      ...(Object.keys(incomplete).length === 0 ? {} : { incomplete }),
    };
  }

  async #take(request: CommitAskRequest, kept: Kept): Promise<void> {
    await this.ports.started();
    const setup = this.ports.setup();
    if (setup.phase === "failed" || setup.phase === "changed") {
      kept.phase = "failed";
      kept.text = setup.phase === "failed" ? setup.text : changedText(setup);
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
    kept.refused = chosen.refused;
    kept.selects = chosen.selects;
    kept.files = [...chosen.named, ...chosen.rest];
    // Row 023-50 (round 6 V3): a call that names paths leads with every file it queues, those
    // under a named folder and the readers of a named path too, named files first, in one
    // batch per group (a later leading batch ranks first). A call that names none leads none.
    const options: NarrowRunOptions =
      request.named.length > 0 ? { at: true, lead: true } : { at: true };
    await this.#queue(kept.files, options, kept);
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
    change: ask.change,
    phase,
    ...(ask.text === undefined ? {} : { text: ask.text }),
    files: [...ask.files],
    readers: { ...ask.readers },
    problems: [...ask.problems],
    ...(ask.refused.length === 0 ? {} : { refused: [...ask.refused] }),
    ...(ask.selects === undefined ? {} : { selects: ask.selects }),
  };
}

/** What one ask runs: the named files, the rest, and the readers of named paths that are no test file. */
interface Chosen {
  readonly named: readonly TestFileRef[];
  readonly rest: readonly TestFileRef[];
  readonly readers: Record<RelativePath, readonly TestFileRef[]>;
  /** D4.9: the chosen files that do not run, and why. */
  readonly refused: readonly CommitRefusal[];
  /** Row 023-53 (V8): the files the change selects, with a result or not, whatever the call names. */
  readonly selects: number;
}

/**
 * D4.5 at the commit, as the call's keying chose before row 023-40c: the
 * candidates are the files the call's paths select (by path, or for a path
 * that is no test file, the files that read it), every file when it names
 * none. Of the candidates with no result at their live key, a test file
 * the call names by its own path runs first, whatever the change; the
 * others run when the change selects them (or when they have no key, which
 * no closure index holds), or every one with `--all-missing`. `null` when
 * no scheduler serves.
 */
export async function choose(request: CommitAskRequest, ports: AtAskPorts): Promise<Chosen | null> {
  const rows = ports.rows();
  // Row 023-53 (V8): the change's selection is read with `--all-missing` too, for its count.
  const changed = (await ports.changedSelects(request.changed)) ?? (request.allMissing ? [] : null);
  if (changed === null) return null;
  const readers: Record<RelativePath, readonly TestFileRef[]> = {};
  for (const path of request.named) {
    if (rows.some((row) => selects([path], row.testFile.path))) continue;
    readers[path] = (await ports.changedSelects([path])) ?? [];
  }
  const read = new Set(Object.values(readers).flat().map(testFileId));
  const candidate = (ref: TestFileRef) =>
    request.named.length === 0 || selects(request.named, ref.path) || read.has(testFileId(ref));
  const own = new Set(request.named);
  const selected = new Set(changed.map(testFileId));
  // 023-46's seam: a file with no key is in no closure index, so it is selected, never unaffected.
  const selectedCount = rows.filter(
    (r) => r.key === null || selected.has(testFileId(r.testFile)),
  ).length;
  const first: TestFileRef[] = [];
  const rest: TestFileRef[] = [];
  for (const { testFile, key } of rows) {
    if (!candidate(testFile) || (key !== null && ports.stored(testFile, key))) continue;
    const id = testFileId(testFile);
    if (own.has(testFile.path)) first.push(testFile);
    else if (request.allMissing || selected.has(id) || key === null) rest.push(testFile);
  }
  const needs = await ports.needs(request);
  const refused = refusals([...first, ...rest], needs);
  const runs = (ref: TestFileRef) => !refused.has(testFileId(ref));
  return {
    named: first.filter(runs),
    rest: rest.filter(runs),
    readers,
    refused: [...refused.values()],
    selects: selectedCount,
  };
}

/**
 * D4.9 (review wave-7 B2, B6) over the chosen files: one whose closure reads
 * a path git does not hold at the commit (`needs`) is refused, and so is
 * every other project's file at its path, which runs with it.
 */
function refusals(
  chosen: readonly TestFileRef[],
  needs: ReadonlyMap<string, RelativePath>,
): Map<string, CommitRefusal> {
  const out = new Map<string, CommitRefusal>();
  const byPath = new Map<RelativePath, { ref: TestFileRef; why: string }>();
  for (const ref of chosen) {
    const path = needs.get(testFileId(ref));
    if (path === undefined) continue;
    const reason = `needs ${path}`;
    out.set(testFileId(ref), { ref, reason });
    if (!byPath.has(ref.path)) byPath.set(ref.path, { ref, why: reason });
  }
  for (const ref of chosen) {
    const sibling = byPath.get(ref.path);
    if (sibling === undefined || out.has(testFileId(ref))) continue;
    const project =
      sibling.ref.project === "" ? "the default project" : `project ${sibling.ref.project}`;
    out.set(testFileId(ref), {
      ref,
      reason: `it runs with ${project}'s ${ref.path}: ${sibling.why}`,
    });
  }
  return out;
}
