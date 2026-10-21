import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SLOT_WAITER_FRESH_MS } from "../slow/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";
import type { Demand } from "./share.js";

/** A daemon's mark in the pool's directory: its backlog demand and what it holds. */
export interface PoolMark extends Demand {
  /** The workers its backlog tiers run with now: its permits. */
  readonly grant: number;
}

const MARK_PREFIX = "pool.mark.";

function markPath(dir: AbsolutePath, worktreeId: WorktreeId): AbsolutePath {
  const name = createHash("sha256").update(worktreeId).digest("hex").slice(0, 16);
  return join(dir, `${MARK_PREFIX}${name}`);
}

/**
 * Writes or refreshes `mark`. Written beside and renamed over the old one,
 * so a reader never sees half of it.
 */
export function writeMark(dir: AbsolutePath, mark: PoolMark): void {
  const path = markPath(dir, mark.id);
  const body = {
    v: 1,
    id: mark.id,
    want: mark.want,
    grant: mark.grant,
    since: mark.since,
    project: mark.project ?? null,
    ...(mark.slow === true ? { slow: true } : {}),
    ...(mark.least !== undefined && mark.least > 1 ? { least: mark.least } : {}),
  };
  writeFileSync(`${path}.tmp`, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

export function clearMark(dir: AbsolutePath, worktreeId: WorktreeId): void {
  rmSync(markPath(dir, worktreeId), { force: true });
}

/**
 * The other daemons' marks younger than `SLOT_WAITER_FRESH_MS`. A holder
 * refreshes its mark while its tier runs, so every live holder's mark is
 * fresh; a dead holder's goes stale within 30 s, while its permits returned
 * when it died. A mark that cannot be read or parsed is skipped.
 */
export function readMarks(dir: AbsolutePath, worktreeId: WorktreeId, now: number): PoolMark[] {
  const own = markPath(dir, worktreeId);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const marks: PoolMark[] = [];
  for (const name of names) {
    const path = join(dir, name);
    if (!name.startsWith(MARK_PREFIX) || name.endsWith(".tmp") || path === own) continue;
    try {
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined || now - stat.mtimeMs >= SLOT_WAITER_FRESH_MS) continue;
      const mark = parseMark(readFileSync(path, "utf8"));
      if (mark !== null && mark.id !== worktreeId) marks.push(mark);
    } catch {
      // Removed or rewritten while read: the daemon is between tiers.
    }
  }
  return marks;
}

function parseMark(text: string): PoolMark | null {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) return null;
  const { id, want, grant, since, project, slow, least } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !isCount(want) || !isCount(grant)) return null;
  if (since !== null && typeof since !== "number") return null;
  const mark = {
    id,
    want,
    grant,
    since,
    ...(slow === true ? { slow: true } : {}),
    ...(isCount(least) && least > 1 ? { least } : {}),
  };
  if (project === null || project === undefined) return mark;
  const p = project as Record<string, unknown>;
  if (typeof p.id !== "string" || !isCount(p.slots)) return mark;
  return { ...mark, project: { id: p.id, slots: p.slots } };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
