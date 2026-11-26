import { createHash } from "node:crypto";
import { delimiter } from "node:path";

/*
 * Spec 027 D1, D2 (row 027-02): every concurrent batch process holds a
 * slot, the lowest free integer from 1, so a project's tests can name a
 * database, a Redis index or a tox environment of their own. Two worktrees
 * sharing one service tell their slots apart by `worktreeSlotToken`. Slots
 * are runtime isolation only: no key reads them.
 */

/** One batch's slot: its number from 1 and the worktree-unique name. */
export interface Slot {
  readonly slot: number;
  /** `<token>_<slot>`, `worktreeSlotToken` of the worktree first. */
  readonly worktreeSlot: string;
}

/**
 * Slots `1..max` (unbounded without `max`), each held by one batch at a
 * time. `acquire` gives the lowest free one, or waits for a release when
 * all `max` are held.
 */
export class SlotPool {
  readonly #held = new Set<number>();
  readonly #waiting: (() => void)[] = [];
  readonly #max: number | undefined;

  constructor(max?: number) {
    this.#max = max;
  }

  /** The lowest free slot, once one is free; `null` when `signal` aborts first. */
  async acquire(signal?: AbortSignal): Promise<number | null> {
    for (;;) {
      if (signal?.aborted === true) return null;
      const free = this.#lowestFree();
      if (free !== null) {
        this.#held.add(free);
        return free;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal?.removeEventListener("abort", wake);
          const at = this.#waiting.indexOf(wake);
          if (at >= 0) this.#waiting.splice(at, 1);
          resolve();
        };
        this.#waiting.push(wake);
        signal?.addEventListener("abort", wake, { once: true });
      });
    }
  }

  release(slot: number): void {
    if (this.#held.delete(slot)) this.#wake();
  }

  #lowestFree(): number | null {
    for (let slot = 1; this.#max === undefined || slot <= this.#max; slot++) {
      if (!this.#held.has(slot)) return slot;
    }
    return null;
  }

  #wake(): void {
    for (const wake of this.#waiting.splice(0)) wake();
  }
}

const pools = new Map<string, SlotPool>();

/**
 * The process's one pool for a worktree's project and cap, so two runs of
 * the same project at once never share a slot. A policy reload that changes
 * `max` starts a new pool for the runs after it.
 */
export function slotPool(root: string, project: string, max?: number): SlotPool {
  const key = `${root}\0${project}\0${max ?? ""}`;
  let pool = pools.get(key);
  if (pool === undefined) {
    pool = new SlotPool(max);
    pools.set(key, pool);
  }
  return pool;
}

/** D1.2: the first 8 hex characters of SHA-256 of the worktree's path, a real path. */
export function worktreeSlotToken(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 8);
}

/** `slot` in the worktree at `root`, a real path. */
export function slotOf(root: string, slot: number): Slot {
  return { slot, worktreeSlot: `${worktreeSlotToken(root)}_${slot}` };
}

const PLACEHOLDER = /\{(slot|slot0|worktreeSlot)\}/g;

/**
 * D2.1, D2.3: `{slot}`, `{slot0}` (the slot less one) and `{worktreeSlot}`
 * replaced; every other brace, such as a JSON value's, stays literal.
 */
export function expandSlotTemplate(value: string, slot: Slot): string {
  return value.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "slot") return String(slot.slot);
    if (name === "slot0") return String(slot.slot - 1);
    return slot.worktreeSlot;
  });
}

/**
 * D1.3: the variables a batch process gets for its slot;
 * `TOX_PARALLEL_ENV` only when the project asks for it.
 */
export function slotVariables(slot: Slot, toxParallelEnv: boolean): Record<string, string> {
  return {
    SQUEAL_SLOT: String(slot.slot),
    SQUEAL_WORKTREE_SLOT: slot.worktreeSlot,
    ...(toxParallelEnv ? { TOX_PARALLEL_ENV: slot.worktreeSlot } : {}),
  };
}

/**
 * D2.1: `templates` (a project's `env`) expanded for `slot`, over `env`, the
 * environment a runner composed from them before any explicit override.
 * Each entry (split on the path delimiter) of a variable's value that is an
 * entry of its template expands, so a value the runner built around the
 * template, such as `PATH` behind an activation's `bin` or `PYTHONPATH`
 * before a runtime directory, expands its template's part too; a value set
 * by another source, holding none of the template's entries, keeps its own.
 */
export function expandedVariables(
  env: Readonly<Record<string, string | undefined>>,
  templates: Readonly<Record<string, string>>,
  slot: Slot,
): Record<string, string> {
  const expanded: Record<string, string> = {};
  for (const [name, template] of Object.entries(templates)) {
    const value = env[name];
    if (value === undefined) continue;
    const entries = new Set(template.split(delimiter));
    expanded[name] = value
      .split(delimiter)
      .map((entry) => (entries.has(entry) ? expandSlotTemplate(entry, slot) : entry))
      .join(delimiter);
  }
  return expanded;
}
