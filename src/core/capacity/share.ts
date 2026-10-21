/** One daemon with backlog work, as its pool mark (or the caller itself) states it. */
export interface Demand {
  /** The daemon's mark: its worktree id. */
  readonly id: string;
  /** The workers its backlog tiers want, running and next, at least 1. */
  readonly want: number;
  /** Since when it has had less than its share; `null` while it has its share. */
  readonly since: number | null;
  /**
   * It waits for slow-lane tiers only (task 004-61): every fast-lane waiter
   * is served before it. Absent, a fast lane's, as an older daemon's mark reads.
   */
  readonly slow?: boolean;
  /**
   * The fewest workers its waiting tier runs with (row 011-97: a Vitest
   * project with `isolate: false` runs 2 at a grant of 1). Absent, 1.
   */
  readonly least?: number;
  /** Its project, when the user caps the project's daemons together (`capacity.projects`). */
  readonly project?: { readonly id: string; readonly slots: number };
}

/**
 * Each daemon's fair share of the host's `hostSlots`, in workers.
 *
 * Spec 001 D11 Capacity (task 001-376): the host's slots divided by the
 * daemons with backlog work, and the slots one daemon cannot use go to the
 * others. That is max-min fairness: a daemon that wants less than an equal
 * share gets what it wants and the rest is shared again among the others
 * (`waterFill`). A capped project's daemons are first shared its slots the
 * same way. What an equal division leaves over goes one slot each to the
 * longest waiters. With fewer slots than daemons the others' share is 0:
 * no daemon runs a backlog worker without a permit (011 C10 as amended
 * 2026-10-21, row 011-96), and a daemon left with none waits, so it is a
 * longest waiter at the next division. A share below its demand's `least`
 * is raised to it from the most junior shares (`raiseToLeast`).
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
  raiseToLeast(senior, shares, capped);
  return shares;
}

/**
 * A tier that runs no fewer than `least` workers can use no share below it
 * (row 011-97). In seniority order, such a share is raised to `least` from
 * the most junior shares. Where those hold too little it stays as it is:
 * the tier waits, and is raised once it is senior to enough of them.
 */
function raiseToLeast(
  senior: readonly Demand[],
  shares: Map<string, number>,
  capped: ReadonlyMap<string, number>,
): void {
  senior.forEach((demand, i) => {
    const share = shares.get(demand.id) ?? 0;
    const least = Math.min(demand.least ?? 1, capped.get(demand.id) ?? 1);
    if (share === 0 || share >= least) return;
    const juniors = senior.slice(i + 1).reverse();
    if (juniors.reduce((sum, j) => sum + (shares.get(j.id) ?? 0), 0) < least - share) return;
    let short = least - share;
    for (const junior of juniors) {
      const taken = Math.min(short, shares.get(junior.id) ?? 0);
      shares.set(junior.id, (shares.get(junior.id) ?? 0) - taken);
      short -= taken;
    }
    shares.set(demand.id, least);
  });
}

/**
 * Fast-lane waiters before slow-lane ones (task 004-61), the longest waiter
 * first; a daemon that has its share after every waiter; then by id.
 */
function bySeniority(a: Demand, b: Demand): number {
  const waits = (d: Demand) => d.since !== null;
  const slowFirst = Number(waits(a) && a.slow === true) - Number(waits(b) && b.slow === true);
  if (waits(a) && waits(b) && slowFirst !== 0) return slowFirst;
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
