import type { AbsolutePath } from "./common.js";

/**
 * Spec 001 D11 Capacity: the user-level `config.json`, never committed.
 * Every key optional; `hostSlots` defaults from the CPU count when loaded.
 */
export interface UserConfig {
  readonly capacity: {
    /** Test processes Squeal starts on this host across every daemon of the user. */
    readonly hostSlots: number;
    /** Repository root path, normalized, to the slots its daemons share together. */
    readonly projects: Readonly<Record<AbsolutePath, { readonly slots: number }>>;
  };
}

export interface LoadedUserConfig {
  /** The file read, for the note's prefix. */
  readonly path: AbsolutePath;
  readonly config: UserConfig;
  readonly problems: readonly string[];
  /**
   * `capacity.hostSlots` was above the CPU count and is cut to it (011 C10
   * Size as amended 2026-10-21, row 011-98): the note's sentence.
   */
  readonly cut?: string;
}

/**
 * What one repository's daemons may use (D11 Capacity): the host's slots,
 * and its own cap when `capacity.projects` names it, never above the host's.
 */
export interface Capacity {
  readonly hostSlots: number;
  readonly projectSlots?: number;
}
