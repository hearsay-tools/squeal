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

/** What a pass keys with: the provider's snapshot and the install fingerprint (D5). */
export interface Ready {
  readonly provider: LintProvider;
  readonly snapshot: LintSnapshot;
  readonly installed: string;
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

  constructor(
    private readonly factory: () => LintProvider,
    private readonly installed: () => Promise<string>,
  ) {}

  /** Why it is off, or `null`. */
  get off(): string | null {
    return this.#off?.reason ?? null;
  }

  /**
   * The provider ready to key and lint at `latest`, given the paths
   * changed since the last keying (`since`), or why it is off. A changed
   * module file may move the program (D5): the provider reads it again
   * (`refresh("none")`), so this pass's keys hold it before any lookup
   * (wave 1.5, review 0.1.348 B3).
   */
  async ready(
    changed: (since: RevisionNumber) => readonly RelativePath[],
    since: RevisionNumber,
    latest: RevisionNumber,
  ): Promise<Ready | LintOff> {
    if (this.#off !== null && !changed(this.#off.revision).some(mayTurnOn)) {
      return { off: this.#off.reason };
    }
    if (this.#provider === null) return this.#open(latest);
    const paths = changed(since);
    const snapshot = this.#snapshot as LintSnapshot;
    const level = refreshLevel(paths, snapshot.declaration, snapshot.closure);
    if (level === "none" && !paths.some((p) => MODULE_EXTENSIONS.has(extname(p)))) {
      return this.#ready();
    }
    return this.#refresh(level, latest);
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

  async #open(latest: RevisionNumber): Promise<Ready | LintOff> {
    const provider = this.factory();
    this.#provider = provider;
    this.#off = null;
    const opened = await provider.open();
    if ("off" in opened) return this.turnOff(opened.off, latest);
    return this.#refresh("none", latest, true);
  }

  /** The install fingerprint is read again when the provider opens and at a thread refresh. */
  async #refresh(
    level: LintRefresh,
    latest: RevisionNumber,
    opened = false,
  ): Promise<Ready | LintOff> {
    const provider = this.#provider as LintProvider;
    const snapshot = await provider.refresh(level);
    if ("off" in snapshot) return this.turnOff(snapshot.off, latest);
    this.#snapshot = snapshot;
    if (opened || level === "thread") this.#installed = await this.installed();
    return this.#ready();
  }

  #ready(): Ready {
    return {
      provider: this.#provider as LintProvider,
      snapshot: this.#snapshot as LintSnapshot,
      installed: this.#installed,
    };
  }
}
