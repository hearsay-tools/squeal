import { basename } from "node:path";
import { isInstalledLockfile } from "../../keys/environment.js";
import type { RelativePath, RevisionNumber } from "../../types/index.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintOff,
  LintProvider,
  LintRefresh,
  LintSnapshot,
} from "./provider.js";

/**
 * Spec 017 D4: how a revision's changed paths refresh the worker. A file
 * the config loaded, a tsconfig among them, or the installed lockfile (011
 * C11) needs a new thread; a config file a new instance; anything else
 * none.
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
    if (isInstalledLockfile(path) || (loaded.has(path) && !config.has(path))) return "thread";
    if (config.has(path)) level = "instance";
  }
  return level;
}

/** D9: a change that may turn an off provider on: a flat config, a manifest or an install. */
export function mayTurnOn(path: RelativePath): boolean {
  const name = basename(path);
  return (
    /^eslint\.config\.[cm]?[jt]s$/.test(name) ||
    name === "package.json" ||
    isInstalledLockfile(path)
  );
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
   * changed since the last keying (`since`), or why it is off.
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
    const snapshot = this.#snapshot as LintSnapshot;
    const level = refreshLevel(changed(since), snapshot.declaration, snapshot.closure);
    if (level === "none") return this.#ready();
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
    return this.#refresh("none", latest);
  }

  async #refresh(level: LintRefresh, latest: RevisionNumber): Promise<Ready | LintOff> {
    const provider = this.#provider as LintProvider;
    const snapshot = await provider.refresh(level);
    if ("off" in snapshot) return this.turnOff(snapshot.off, latest);
    this.#snapshot = snapshot;
    if (level !== "instance") this.#installed = await this.installed();
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
