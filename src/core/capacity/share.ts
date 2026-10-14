/** One daemon with backlog work, as its pool mark (or the caller itself) states it. */
export interface Demand {
  /** The daemon's mark: its worktree id. */
  readonly id: string;
  /** The workers its backlog tiers want, running and next, at least 1. */
  readonly want: number;
  /** Since when it has had less than its share; `null` while it has its share. */
  readonly since: number | null;
  /** Its project, when the user caps the project's daemons together (`capacity.projects`). */
  readonly project?: { readonly id: string; readonly slots: number };
}

/**
 * Each daemon's fair share of the host's `hostSlots`, in workers, at least 1.
 *
 * Spec 001 D11 Capacity (task 001-376): the host's slots divided by the
 * daemons with backlog work, and the slots one daemon cannot use go to the
 * others. That is max-min fairness: a daemon that wants less than an equal
 * share gets what it wants and the rest is shared again among the others
 * (`waterFill`). A capped project's daemons are first shared its slots the
 * same way. What an equal division leaves over goes one slot each to the
 * longest waiters. The floor of 1 is the free backlog worker every daemon
 * has without a permit.
 */
export function fairShares(hostSlots: number, demands: readonly Demand[]): Map<string, number> {
  const senior = [...demands].sort(bySeniority);
  const capped = new Map<string, number>();
  const projects = new Map<string, { slots: number; members: Demand[] }>();
  for (const demand of senior) {
    capped.set(demand.id, Math.max(1, demand.want));
    if (demand.project === undefined) continue;
    const group = projects.get(demand.project.id) ?? { slots: demand.project.slots, members: [] };
    group.slots = Math.min(group.slots, demand.project.slots);
    group.members.push(demand);
    projects.set(demand.project.id, group);
  }
  for (const { slots, members } of projects.values()) {
    const shares = waterFill(
      slots,
      members.map((m) => ({ id: m.id, want: capped.get(m.id) ?? 1 })),
    );
    for (const [id, share] of shares) capped.set(id, share);
  }
  const shares = waterFill(
    hostSlots,
    senior.map((d) => ({ id: d.id, want: capped.get(d.id) ?? 1 })),
  );
  for (const [id, share] of shares) shares.set(id, Math.max(1, share));
  return shares;
}

/** The longest waiter first; a daemon that has its share after every waiter; then by id. */
function bySeniority(a: Demand, b: Demand): number {
  const since = (a.since ?? Number.POSITIVE_INFINITY) - (b.since ?? Number.POSITIVE_INFINITY);
  if (since !== 0 && !Number.isNaN(since)) return since;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Max-min fair division of `total` among `entries`, in seniority order: the
 * entries wanting no more than an equal share get their want, the rest share
 * what is left equally, the remainder one each to the first of them.
 */
function waterFill(
  total: number,
  entries: readonly { readonly id: string; readonly want: number }[],
): Map<string, number> {
  const shares = new Map<string, number>();
  let left = Math.max(0, total);
  let pending = [...entries];
  while (pending.length > 0) {
    const level = Math.floor(left / pending.length);
    const small = pending.filter((e) => e.want <= level);
    if (small.length === 0) {
      let extra = left - level * pending.length;
      for (const e of pending) {
        shares.set(e.id, level + (extra > 0 ? 1 : 0));
        extra--;
      }
      break;
    }
    for (const e of small) {
      shares.set(e.id, e.want);
      left -= e.want;
    }
    pending = pending.filter((e) => e.want > level);
  }
  return shares;
}
