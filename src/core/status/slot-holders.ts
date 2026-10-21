import { readPolicy } from "../daemon/policy.js";
import { heldPermits, type PermitRecord, slowSlotDir } from "../slow/index.js";
import { durationText, readSlowTier, worktreeSlowView } from "../state/index.js";
import { plural } from "../text.js";
import type {
  AbsolutePath,
  EpochMs,
  SlotHolder,
  SlowSlotHolders,
  StatusHeader,
  StatusSnapshot,
  Store,
  WorktreeId,
} from "../types/index.js";

/*
 * Row 011-58 (gh-58; spec 004 D2 and D8): while this worktree's slow tier
 * waits for the per-user slow slot, who holds it: each held permit's
 * holder, as its lock file records it, with what the store knows of that
 * worktree's slow tier. Read only while the live daemon says it waits for
 * the slot, so no other status read touches the slot's directory.
 * Prioritization across worktrees stays out.
 */

/** Whether process `pid` runs: `kill(pid, 0)` signals nothing. Another user's runs too. */
export function pidRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The slot's holders, when the live daemon (`alive`) published that its
 * pending slow files wait for the slot; `undefined` otherwise, or when the
 * slot's directory is not the user's private one. `root` is this
 * worktree's, whose policy names its permits (`slow.maxParallel`).
 */
export function slowSlotOf(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  header: StatusHeader,
  alive: boolean,
  now: EpochMs,
): SlowSlotHolders | undefined {
  const tier = header.slowTier;
  if (!alive || tier === undefined || tier.pending === 0) return undefined;
  if (tier.activity?.kind !== "waiting" || tier.activity.for !== "slot") return undefined;
  const permits = readPolicy(root).slow.maxParallel;
  let held: ReturnType<typeof heldPermits>;
  try {
    held = heldPermits({ dir: slowSlotDir(), permits });
  } catch {
    return undefined;
  }
  const groups = new Map<string, { record: PermitRecord; permits: number }>();
  for (const { record } of held) {
    const id =
      record.kind === "holder" ? `${record.pid}\0${record.worktreeId}` : `\0${record.kind}`;
    const group = groups.get(id);
    if (group === undefined) groups.set(id, { record, permits: 1 });
    else {
      group.permits++;
      // The earliest take is when the holder's hold began.
      if (record.kind === "holder" && group.record.kind === "holder") {
        if (record.since < group.record.since) group.record = record;
      }
    }
  }
  const holders = [...groups.values()].map(({ record, permits: n }) =>
    holderOf(store, worktreeId, record, n, now),
  );
  return { permits, holders: holders.sort(longestFirst) };
}

function holderOf(
  store: Store,
  own: WorktreeId,
  record: PermitRecord,
  permits: number,
  now: EpochMs,
): SlotHolder {
  if (record.kind !== "holder") return { kind: record.kind, permits };
  const live = pidRuns(record.pid);
  const root = store.worktrees.get(record.worktreeId)?.root ?? null;
  return {
    kind: live ? "live" : "stale",
    permits,
    pid: record.pid,
    worktreeId: record.worktreeId,
    root,
    ...(record.worktreeId === own ? { self: true as const } : {}),
    since: record.since,
    heldMs: Math.max(0, now - record.since),
    ...(live && root !== null && record.worktreeId !== own
      ? slowWork(store, record.worktreeId as WorktreeId)
      : {}),
  };
}

/** What the store knows of a holder worktree's slow tier: its running files and pending count. */
function slowWork(
  store: Store,
  worktreeId: WorktreeId,
): { running?: readonly string[]; pending?: number } {
  const view = worktreeSlowView(store, worktreeId);
  if (view === null) return {};
  const keys = store.testFileKeys.list(worktreeId).filter((row) => view.isSlow(row.testFile));
  const states = store.knownStates.list(
    worktreeId,
    keys.map((row) => row.testFile),
  );
  const tier = readSlowTier(store, worktreeId, states, keys, view);
  const activity = tier.activity;
  const running =
    activity?.kind === "running" ? { running: activity.paths ?? [activity.path] } : {};
  return { ...running, pending: tier.pending };
}

/** The longest held first; records without a holder last. */
function longestFirst(a: SlotHolder, b: SlotHolder): number {
  const since = (h: SlotHolder) => (h.kind === "live" || h.kind === "stale" ? h.since : Infinity);
  return since(a) - since(b);
}

/** `Slow slot: held by /wt/b (pid 4242) for 3 min, running a.test.ts`, while the daemon waits for it. */
export function slowSlotLines(s: StatusSnapshot): string[] {
  return s.slowSlot === undefined ? [] : [`Slow slot: ${slotHoldersText(s.slowSlot)}`];
}

/**
 * Who holds the slot: `held by ...` for a repository of one permit, else
 * `3 of 4 permits held: 2 by ...; 1 by ...`; or that none is held now.
 */
export function slotHoldersText(slot: SlowSlotHolders): string {
  const { holders } = slot;
  if (holders.length === 0) {
    return "no permit is held now; this worktree's daemon takes one on its next pass";
  }
  if (slot.permits === 1 && holders.length === 1 && holders[0] !== undefined) {
    const holder = holders[0];
    return holder.kind === "live" || holder.kind === "stale"
      ? `held by ${byText(holder)}`
      : `held; ${recordText(holder.kind, "its")}`;
  }
  const held = holders.reduce((sum, h) => sum + h.permits, 0);
  const parts = holders.map((h) =>
    h.kind === "live" || h.kind === "stale"
      ? `${h.permits} by ${byText(h)}`
      : `${h.permits} whose ${recordText(h.kind, "").trimStart()}`,
  );
  return `${held} of ${plural(slot.permits, "permit")} held: ${parts.join("; ")}`;
}

/** A missing or unreadable record, after `its` or `whose`. */
function recordText(kind: "missing" | "unreadable", its: string): string {
  return kind === "missing"
    ? `${its} lock file records no holder`
    : `${its} holder record cannot be read`;
}

/** `/wt/b (pid 4242) for 3 min, running a, with 2 more slow test files queued there`. */
function byText(h: Extract<SlotHolder, { kind: "live" | "stale" }>): string {
  const who =
    h.self === true
      ? "this worktree"
      : (h.root ?? `worktree ${h.worktreeId} of another repository`);
  if (h.kind === "stale") {
    return `pid ${h.pid} of ${who}, which is not running: a stale holder record, ${durationText(h.heldMs)} old`;
  }
  return `${who} (pid ${h.pid}) for ${durationText(h.heldMs)}${workText(h)}`;
}

function workText(h: Extract<SlotHolder, { kind: "live" | "stale" }>): string {
  if (h.running !== undefined) {
    const rest = Math.max(0, (h.pending ?? h.running.length) - h.running.length);
    const queued = rest === 0 ? "" : `, with ${plural(rest, "more slow test file")} queued there`;
    return `, running ${listed(h.running)}${queued}`;
  }
  return h.pending === undefined
    ? ""
    : `, with ${plural(h.pending, "slow test file")} pending there`;
}

/** `a`, `a and b`, `a, b and c`. */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}
