import { basename, extname } from "node:path";
import { isInstalledLockfile } from "../../keys/environment.js";
import type { RelativePath, RevisionNumber } from "../../types/index.js";
import { MODULE_EXTENSIONS } from "./keys.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintOff,
  LintProvider,
  LintRefresh,
  LintSnapshot,
} from "./provider.js";
import type { Moved, Unlisted } from "./unlisted.js";

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
 * over the revisions' paths and the unlisted inputs that moved. A changed
 * module file may move the program (D5, wave 1.5): `none` reads it again.
 * A program file gone needs a new thread: the worker's TypeScript service
 * keeps what it read (wave 1.6).
 */
export function refreshOf(
  paths: readonly RelativePath[],
  moved: Moved,
  snapshot: LintSnapshot,
): LintRefresh | null {
  if (moved.deleted.length > 0) return "thread";
  const level = refreshLevel([...paths, ...moved.loaded], snapshot.declaration, snapshot.closure);
  if (level !== "none") return level;
  const module = (path: RelativePath) => MODULE_EXTENSIONS.has(extname(path));
  return moved.program.length > 0 || paths.some(module) ? "none" : null;
}

/** Refreshes one pass may run: inputs that move during each make another. */
const ROUNDS = 3;

/** What a pass keys with: the provider's snapshot and the install fingerprint (D5). */
export interface Ready {
  readonly provider: LintProvider;
  readonly snapshot: LintSnapshot;
  readonly installed: string;
  /** Unlisted program files whose bytes moved: the next lint call feeds them (wave 1.6). */
  readonly feed: readonly RelativePath[];
}

/**
 * Unlisted inputs still moved after `ROUNDS` refreshes: the pass keys
 * nothing and looks again. The refresh they call for is due then.
 */
export interface Moving {
  readonly moving: readonly RelativePath[];
  readonly feed: readonly RelativePath[];
}

const LEVELS: readonly LintRefresh[] = ["none", "instance", "thread"];

/** The higher of two refreshes; `null` is none at all. */
function higher(a: LintRefresh | null, b: LintRefresh | null): LintRefresh | null {
  if (a === null || b === null) return a ?? b;
  return LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;
}

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

  constructor(
    private readonly factory: () => LintProvider,
    private readonly installed: () => Promise<string>,
    private readonly unlisted: Unlisted,
  ) {}

  /** Why it is off, or `null`. */
  get off(): string | null {
    return this.#off?.reason ?? null;
  }

  /**
   * The provider ready to key and lint at `latest`, given the paths
   * changed since the last keying (`since`), or why it is off. Before any
   * lookup, the key inputs `listed` does not hold are read on disk
   * (`Unlisted`), and the refresh their moves and the revisions' paths call
   * for runs (`refreshOf`). Each refresh may bring new inputs or race an
   * edit: they are read again, up to `ROUNDS` refreshes.
   */
  async ready(
    changed: (since: RevisionNumber) => readonly RelativePath[],
    since: RevisionNumber,
    latest: RevisionNumber,
    listed: (path: RelativePath) => boolean,
  ): Promise<Ready | LintOff | Moving> {
    if (this.#off !== null && !changed(this.#off.revision).some(mayTurnOn)) {
      return { off: this.#off.reason };
    }
    if (this.#provider !== null) return this.#settle(changed(since), latest, listed);
    const off = await this.#open(latest);
    return off ?? this.#settle([], latest, listed);
  }

  /** The looks and refreshes of `ready`, from the revisions' `paths`. */
  async #settle(
    revised: readonly RelativePath[],
    latest: RevisionNumber,
    listed: (path: RelativePath) => boolean,
  ): Promise<Ready | LintOff | Moving> {
    const feed = new Set<RelativePath>();
    let paths = revised;
    for (let round = 0; ; round++) {
      const snapshot = this.#snapshot as LintSnapshot;
      const moved = this.unlisted.look(snapshot, listed, new Set(paths));
      for (const path of moved.program) feed.add(path);
      const level = higher(refreshOf(paths, moved, snapshot), this.#due);
      if (level === null) return { ...this.#ready(), feed: [...feed] };
      if (round === ROUNDS) {
        this.#due = level;
        return { moving: [...moved.loaded, ...moved.program, ...moved.deleted], feed: [...feed] };
      }
      const off = await this.#refresh(level, latest);
      if (off !== null) return off;
      this.#due = null;
      paths = [];
    }
  }

  /** A lint report's environment is the one the next keys hold. */
  observe(environment: LintEnvironment): void {
    if (this.#snapshot === null) return;
    const { closure, packages, program, env } = environment;
    this.#snapshot = { ...this.#snapshot, closure, packages, program, env };
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

  /** A new provider: it reads every unlisted input from disk. `null` once open. */
  async #open(latest: RevisionNumber): Promise<LintOff | null> {
    const provider = this.factory();
    this.#provider = provider;
    this.#off = null;
    this.#due = null;
    this.unlisted.forget();
    const opened = await provider.open();
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
    this.#snapshot = snapshot;
    if (opened || level === "thread") this.#installed = await this.installed();
    return null;
  }

  #ready(): Omit<Ready, "feed"> {
    return {
      provider: this.#provider as LintProvider,
      snapshot: this.#snapshot as LintSnapshot,
      installed: this.#installed,
    };
  }
}
