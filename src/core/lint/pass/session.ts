import { basename, extname } from "node:path";
import type { ObjectFormat } from "../../hash/index.js";
import { isInstalledLockfile } from "../../keys/environment.js";
import type { FileHash, RelativePath, RevisionNumber } from "../../types/index.js";
import { type Disagreement, disagreement, readClosure } from "./held.js";
import { MODULE_EXTENSIONS } from "./keys.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintHeld,
  LintOff,
  LintProvider,
  LintRefresh,
  LintSnapshot,
} from "./provider.js";
import type { Unlisted } from "./unlisted.js";

/**
 * A flat config file at any depth: ESLint reads one per directory, and
 * `configFiles` lists only the root's (017-04, 2026-10-26).
 */
export function isFlatConfig(path: RelativePath): boolean {
  return /^eslint\.config\.[cm]?[jt]s$/.test(basename(path));
}

/**
 * Spec 017 D4: how a revision's changed paths refresh the worker. The
 * installed lockfile (011 C11) needs a new thread; a config file, nested
 * ones included, a new instance; another file the config loaded, a
 * tsconfig among them, a new thread; anything else none.
 */
export function refreshLevel(
  changed: readonly RelativePath[],
  declaration: LintDeclaration,
  closure: readonly RelativePath[],
): LintRefresh {
  const config = new Set(declaration.configFiles);
  const loaded = new Set(closure);
  let level: LintRefresh = "none";
  for (const path of changed) {
    if (isInstalledLockfile(path)) return "thread";
    if (isFlatConfig(path) || config.has(path)) level = "instance";
    else if (loaded.has(path)) return "thread";
  }
  return level;
}

/** D9: a change that may turn an off provider on: a flat config, a manifest or an install. */
export function mayTurnOn(path: RelativePath): boolean {
  return isFlatConfig(path) || basename(path) === "package.json" || isInstalledLockfile(path);
}

/**
 * The refresh a pass runs before it keys, or `null` for none: D4's level
 * over the revisions' paths and the loaded files the worker holds at other
 * bytes. A changed module file may move the program (D5, wave 1.5), and so
 * may a file the walk read at other bytes or a lookup whose state moved
 * (wave 1.7 Q3): `none` reads it again. A file the worker holds that is gone
 * needs a new thread: TypeScript's service keeps what it read (wave 1.6).
 */
export function refreshOf(
  paths: readonly RelativePath[],
  seen: Pick<Disagreement, "loaded" | "renew" | "walked" | "lookups">,
  snapshot: LintSnapshot,
): LintRefresh | null {
  if (seen.renew.length > 0) return "thread";
  const level = refreshLevel([...paths, ...seen.loaded], snapshot.declaration, snapshot.closure);
  if (level !== "none") return level;
  const module = (path: RelativePath) => MODULE_EXTENSIONS.has(extname(path));
  return seen.walked.length > 0 || seen.lookups || paths.some(module) ? "none" : null;
}

/** Refreshes one pass may run: inputs that move during each make another. */
const ROUNDS = 3;

/** What a pass keys with: the provider's snapshot and the install fingerprint (D5). */
export interface Ready {
  readonly provider: LintProvider;
  readonly snapshot: LintSnapshot;
  readonly installed: string;
  /** Program files TypeScript holds at other bytes than the keys': the next lint call feeds them. */
  readonly feed: readonly RelativePath[];
}

/**
 * The worker still held other bytes than the keys after `ROUNDS`
 * refreshes: the pass keys nothing and looks again. The refresh they call
 * for is due then.
 */
export interface Moving {
  readonly moving: readonly RelativePath[];
  readonly feed: readonly RelativePath[];
}

/** The listing at the pass's revision, as the session reads it (wave 1.7). */
export interface Listing {
  /** A listed file's blob; `null` for a path the listing does not hold. */
  readonly blobOf: (path: RelativePath) => FileHash | null;
  /** The listed files the program segment holds, once a key holds it; `null` while none does (P3). */
  readonly segment: () => ((path: RelativePath) => boolean) | null;
}

const LEVELS: readonly LintRefresh[] = ["none", "instance", "thread"];

/** The higher of two refreshes; `null` is none at all. */
function higher(a: LintRefresh | null, b: LintRefresh | null): LintRefresh | null {
  if (a === null || b === null) return a ?? b;
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

const same = (a: LintHeld | undefined, b: LintHeld | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The provider's life in the pass (D3, D9): opened at the first pass that
 * needs it, refreshed as each pass's changes say, and closed when it turns
 * itself off. Off, it opens again only after a revision changes a path
 * `mayTurnOn` names.
 */
export class ProviderSession {
  #provider: LintProvider | null = null;
  #snapshot: LintSnapshot | null = null;
  #installed = "none";
  #off: { readonly reason: string; readonly revision: RevisionNumber } | null = null;
  /** The refresh a pass that ended `Moving` left due. */
  #due: LintRefresh | null = null;
  #listing: Listing = { blobOf: () => null, segment: () => null };
  /** Paths a rule or a module held at other bytes after a lint call: a new thread reads them (P2). */
  readonly #stuck = new Set<RelativePath>();
  /** What the last pass that ended `Moving` disagreed on; the same again is no edit. */
  #lastMoving: string | null = null;
  /** Paths whose disagreement refreshes did not move, at the blob it was seen at. */
  readonly #settled = new Map<RelativePath, FileHash | null>();

  constructor(
    private readonly factory: () => LintProvider,
    private readonly installed: () => Promise<string>,
    private readonly unlisted: Unlisted,
    private readonly format: ObjectFormat = "sha1",
  ) {}

  /** Why it is off, or `null`. */
  get off(): string | null {
    return this.#off?.reason ?? null;
  }

  /**
   * The provider ready to key and lint at `latest`, given the paths
   * changed since the last keying (`since`), or why it is off. Before any
   * lookup, the key inputs the listing does not hold are read on disk
   * (`Unlisted`), each path the worker holds is compared with the pass's
   * blob (P1), and the refresh the disagreements and the revisions' paths
   * call for runs (`refreshOf`). Each refresh may bring new inputs or race
   * an edit: they are compared again, up to `ROUNDS` refreshes.
   */
  async ready(
    changed: (since: RevisionNumber) => readonly RelativePath[],
    since: RevisionNumber,
    latest: RevisionNumber,
    listing: Listing,
  ): Promise<Ready | LintOff | Moving> {
    this.#listing = listing;
    if (this.#off !== null && !changed(this.#off.revision).some(mayTurnOn)) {
      return { off: this.#off.reason };
    }
    if (this.#provider !== null) return this.#settle(changed(since), latest);
    const off = await this.#open(latest);
    return off ?? this.#settle([], latest);
  }

  /** The compares and refreshes of `ready`, from the revisions' `paths`. */
  async #settle(
    revised: readonly RelativePath[],
    latest: RevisionNumber,
  ): Promise<Ready | LintOff | Moving> {
    const feed = new Set<RelativePath>();
    let paths = revised;
    /** What the worker held of each loaded file it disagreed on, before a refresh below `thread`. */
    let before: ReadonlyMap<RelativePath, LintHeld | undefined> | null = null;
    for (let round = 0; ; round++) {
      const snapshot = this.#snapshot as LintSnapshot;
      const seen = this.#look(snapshot);
      for (const path of seen.feed) feed.add(path);
      let level = higher(refreshOf(paths, seen, snapshot), this.#due);
      // A refresh that did not replace what the worker held, or a lint that did not, calls for a new thread.
      const kept = seen.loaded.some(
        (p) => before?.has(p) && same(before.get(p), snapshot.held?.get(p)),
      );
      if (kept || seen.others.some((p) => this.#stuck.has(p))) level = "thread";
      if (level === null) {
        this.#lastMoving = null;
        return { ...this.#ready(), feed: [...feed] };
      }
      if (round === ROUNDS) {
        this.#due = level;
        const moving = [...seen.loaded, ...seen.renew, ...seen.others, ...seen.walked];
        this.#settles(moving, snapshot);
        return { moving, feed: [...feed] };
      }
      const off = await this.#refresh(level, latest);
      if (off !== null) return off;
      this.#due = null;
      if (level === "thread") this.#stuck.clear();
      before =
        level === "thread" ? null : new Map(seen.loaded.map((p) => [p, snapshot.held?.get(p)]));
      paths = [];
    }
  }

  /** P1 over `snapshot`, its unlisted inputs read on disk first. */
  #look(snapshot: LintSnapshot): Disagreement {
    const { declaration, closure, program, held, walked, lookups } = snapshot;
    const inputs = [...declaration.configFiles, ...closure, ...program];
    const listed = (path: RelativePath) => this.#listing.blobOf(path) !== null;
    this.unlisted.read([...inputs, ...(held?.keys() ?? []), ...(walked?.keys() ?? [])], listed);
    const seen = disagreement(snapshot, this.blobOf, (path, blob) => this.settled(path, blob));
    return { ...seen, lookups: this.unlisted.movedFrom(lookups ?? new Map()) };
  }

  /** A path's blob as this pass keys it: the listing's, or the disk's outside it. */
  readonly blobOf = (path: RelativePath): FileHash | null =>
    this.#listing.blobOf(path) ?? this.unlisted.blobOf(path) ?? null;

  /** Whether refreshes left `path` disagreeing at `blob` twice: the keys that hold it store nothing. */
  settled(path: RelativePath, blob: FileHash | null): boolean {
    if (!this.#settled.has(path)) return false;
    if (this.#settled.get(path) === blob) return true;
    this.#settled.delete(path);
    return false;
  }

  /** A pass ends `Moving` on `paths`; the same disagreement as the last one's is settled. */
  #settles(paths: readonly RelativePath[], snapshot: LintSnapshot): void {
    const blobs = paths.map((p) => [
      p,
      this.blobOf(p),
      snapshot.held?.get(p),
      snapshot.walked?.get(p),
    ]);
    const sign = JSON.stringify(blobs);
    if (sign === this.#lastMoving)
      for (const path of paths) this.#settled.set(path, this.blobOf(path));
    this.#lastMoving = sign;
  }

  /** P2 found paths a rule or a module held at other bytes after a lint call. */
  stuck(paths: readonly RelativePath[]): void {
    for (const path of paths) this.#stuck.add(path);
  }

  /** A lint report's environment is the one the next keys hold, its reads in the closure (P3). */
  observe(environment: LintEnvironment): LintEnvironment {
    if (this.#snapshot === null) return environment;
    this.#snapshot = this.#extend({ ...this.#snapshot, ...environmentOf(environment) });
    return this.#snapshot;
  }

  /** The provider turned itself off at `latest` (D9): it is closed, and the reason kept. */
  async turnOff(reason: string, latest: RevisionNumber): Promise<LintOff> {
    this.#off = { reason, revision: latest };
    await this.close();
    return { off: reason };
  }

  /** Closes the provider; the next `ready` opens a new one. */
  async close(): Promise<void> {
    const provider = this.#provider;
    this.#provider = null;
    this.#snapshot = null;
    await provider?.close();
  }

  /** A new provider: a new thread, which holds nothing yet. `null` once open. */
  async #open(latest: RevisionNumber): Promise<LintOff | null> {
    const provider = this.factory();
    this.#provider = provider;
    this.#off = null;
    this.#due = null;
    this.#stuck.clear();
    this.#settled.clear();
    this.#lastMoving = null;
    const opened = await provider.open(this.format);
    if ("off" in opened) return this.turnOff(opened.off, latest);
    return this.#refresh("none", latest, true);
  }

  /** The install fingerprint is read again when the provider opens and at a thread refresh. */
  async #refresh(
    level: LintRefresh,
    latest: RevisionNumber,
    opened = false,
  ): Promise<LintOff | null> {
    const provider = this.#provider as LintProvider;
    const snapshot = await provider.refresh(level);
    if ("off" in snapshot) return this.turnOff(snapshot.off, latest);
    this.#snapshot = this.#extend(snapshot);
    if (opened || level === "thread") this.#installed = await this.installed();
    return null;
  }

  /** `snapshot` with the files the worker used that no key holds in its closure (P3). */
  #extend(snapshot: LintSnapshot): LintSnapshot {
    const joined = readClosure(snapshot, this.#listing.segment());
    if (joined.length === 0) return snapshot;
    return { ...snapshot, closure: [...new Set([...snapshot.closure, ...joined])].sort() };
  }

  #ready(): Omit<Ready, "feed"> {
    return {
      provider: this.#provider as LintProvider,
      snapshot: this.#snapshot as LintSnapshot,
      installed: this.#installed,
    };
  }
}

/** A report's environment alone, without its results. */
function environmentOf(report: LintEnvironment): LintEnvironment {
  const { closure, packages, program, env, held, walked, lookups } = report;
  return {
    closure,
    packages,
    program,
    env,
    ...(held === undefined ? {} : { held }),
    ...(walked === undefined ? {} : { walked }),
    ...(lookups === undefined ? {} : { lookups }),
  };
}
