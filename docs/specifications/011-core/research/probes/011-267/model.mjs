// Throwaway probe, row 011-267. A small model of one Vitest lane, for replaying
// candidate orders on cezar's recorded workloads. It is not Squeal's scheduler:
// it keeps the rules that decide these traces (tier size, tier sharing, the
// backlog wall budget, the backlog's turn, promoted-only wide tiers, results at
// a tier's end) and leaves out yields, claims, quiet waits and the pool.
//
// Times are seconds from t0. A file: { path, d, cls: 'N'|'E'|'B', own }.

export const TIER_SIZE = 4;
export const BUDGET_S = 120; // min(120 s, runner.timeoutMs / 2), cezar timeoutMs 900 s
export const BACKLOG_MAX = 200;
export const OVERHEAD_S = 1; // a run's fixed cost before its files start (as probes/issue-79)
const SHARE_FLOOR_S = 1;
const SHARE_RATIO = 4;
const TURN_AFTER = 4;
/** A later wait this small (file-seconds) may go ahead of, or beside, an earlier batch. */
export const SMALL_S = 30;

const joins = (span, d) => {
  const fastest = Math.min(span?.fastest ?? d, d);
  const slowest = Math.max(span?.slowest ?? d, d);
  return slowest <= Math.max(SHARE_FLOOR_S, SHARE_RATIO * fastest) ? { fastest, slowest } : null;
};
const wallEstimate = (sum, longest, w) => sum / w + (1 - 1 / w) * longest;

/** Places `files` in order on `w` workers from `at`; returns per-file [start, end]. */
function place(files, w, at, inTier) {
  const order = inTier === 'spt' ? [...files].sort((a, b) => a.d - b.d) : [...files].sort((a, b) => b.d - a.d);
  const free = Array.from({ length: Math.max(1, Math.min(w, order.length)) }, () => at + OVERHEAD_S);
  return order.map((f) => {
    const t = Math.min(...free);
    const i = free.indexOf(t);
    free[i] = t + f.d;
    return { f, start: t, end: t + f.d };
  });
}

/**
 * Runs one simulation.
 * policy: { name, mode: 'tiers'|'slots', order: 'today374'|'today377'|'batch'|'batch-budget'|'edit-first',
 *           inTier: 'lpt'|'spt', onEdit: 'wait'|'beside'|'cancel', batchTurn: number|null }
 * plan:   { waits: [{ at, until, files: paths, agent }], arrivals: [{ at, files: [file] }] , reactive }
 */
export function simulate({ files, initialBusyUntil = 0, W, policy, plan, limit = 4 * 3600 }) {
  const byPath = new Map(files.map((f) => [f.path, { ...f }]));
  const queued = new Set(files.filter((f) => !f.preDone).map((f) => f.path));
  const done = new Map(files.filter((f) => f.preDone).map((f) => [f.path, f.doneAt ?? 0]));
  const batches = []; // { id, files: Set, at }
  const batchOf = new Map();
  const waits = []; // opened waits { at, until, files, agent }
  const flights = []; // { files: [{f,start,end}], end, kind, batch }
  const log = [];
  let now = 0;
  let laneFreeAt = initialBusyUntil;
  let recentTiers = 0;
  let batchTiers = 0;
  let discarded = 0;
  let cuts = 0;
  let editPriority = false;
  const pendingWaits = [...plan.waits].sort((a, b) => a.at - b.at);
  const pendingArrivals = [...(plan.arrivals ?? [])].sort((a, b) => a.at - b.at);
  const freeWorkers = Array.from({ length: W }, () => initialBusyUntil);

  const isPromoted = (p) => waits.some((w) => w.at <= now && now < w.until && w.files.includes(p));
  const promoRank = (p) => {
    let r = Infinity;
    for (const w of waits) if (w.at <= now && now < w.until && w.files.includes(p)) r = Math.min(r, w.at);
    return r;
  };
  const firstGroup = (p) => byPath.get(p).cls === 'E' || isPromoted(p);
  const shortest = (a, b) => byPath.get(a).d - byPath.get(b).d;

  /** C4's order: promoted (request, then shortest), then the edit's work, then the rest. */
  function orderedToday() {
    const q = [...queued];
    const prom = q.filter(isPromoted).sort((a, b) => promoRank(a) - promoRank(b) || shortest(a, b));
    const edit = q.filter((p) => !isPromoted(p) && byPath.get(p).cls === 'E').sort(shortest);
    const rest = q.filter((p) => !isPromoted(p) && byPath.get(p).cls !== 'E').sort(shortest);
    return { prom, edit, rest };
  }

  function backlogTier(order) {
    const picked = [];
    let sum = 0;
    let longest = 0;
    for (const p of order) {
      if (picked.length >= BACKLOG_MAX) break;
      const d = byPath.get(p).d;
      const w = Math.min(W, picked.length + 1);
      if (picked.length >= W && wallEstimate(sum + d, Math.max(longest, d), W) > BUDGET_S) break;
      void w;
      picked.push(p);
      sum += d;
      longest = Math.max(longest, d);
    }
    return picked;
  }
  function editTier(order) {
    const picked = [];
    let span = null;
    for (const p of order) {
      if (picked.length >= TIER_SIZE) break;
      const j = joins(span, byPath.get(p).d);
      if (j === null) continue;
      span = j;
      picked.push(p);
    }
    return picked;
  }

  function startTier(paths, kind, width = W, batch = null) {
    for (const p of paths) queued.delete(p);
    const placed = place(paths.map((p) => byPath.get(p)), width, now, policy.inTier);
    const end = Math.max(...placed.map((x) => x.end));
    const flight = { files: placed, end, kind, batch, start: now };
    flights.push(flight);
    log.push({ at: now, end, kind, files: paths.length, named: paths.filter((p) => byPath.get(p).cls === 'N').length });
    return flight;
  }

  function selectTiers() {
    const { prom, edit, rest } = orderedToday();
    const batchFirst = policy.order === 'batch' || policy.order === 'batch-budget' || policy.order === 'small-first';
    if (batchFirst) {
      const turnDue = policy.batchTurn != null && batchTiers >= policy.batchTurn && rest.length + edit.length > 0;
      const b = turnDue ? undefined : batches.find((x) => [...x.files].some((p) => queued.has(p)));
      if (b) {
        let paths = [...b.files].filter((p) => queued.has(p));
        if (policy.order === 'batch-budget') paths = backlogTier(paths.sort(shortest));
        batchTiers += 1;
        const share = policy.editBeside === 'share' && flights.some((fl) => !fl.closed && fl.kind === 'beside');
        return startTier(paths, 'batch', share ? Math.max(1, W - TIER_SIZE) : W, b);
      }
      batchTiers = 0;
      const e = edit.length ? editTier([...edit, ...rest]) : [];
      if (e.length) return startTier(e, 'edit');
      if (rest.length) return startTier(backlogTier(rest), 'backlog');
      return null;
    }
    // today374 / today377
    const hasFirst = prom.length + edit.length > 0;
    if (!hasFirst) {
      if (!rest.length) return null;
      recentTiers = 0;
      return startTier(backlogTier(rest), 'backlog');
    }
    if (policy.order === 'today377' && edit.length === 0 && prom.length > 0) {
      return startTier(backlogTier(prom), 'promoted');
    }
    if (recentTiers >= TURN_AFTER && rest.length > 0) {
      recentTiers = 0;
      const t = editTier(rest);
      return startTier(t, 'turn');
    }
    const t = editTier([...prom, ...edit, ...rest]);
    const tookBacklog = t.some((p) => !firstGroup(p));
    recentTiers = tookBacklog || rest.length === 0 ? 0 : recentTiers + 1;
    return startTier(t, 'edit');
  }

  /** Slots: each free worker takes the next file of one global order. */
  function slotOrder() {
    const q = [...queued];
    const inBatch = (p) => batchOf.has(p);
    const batchIdx = (p) => batchOf.get(p) ?? Infinity;
    const lpt = policy.inTier === 'spt' ? (a, b) => byPath.get(a).d - byPath.get(b).d : (a, b) => byPath.get(b).d - byPath.get(a).d;
    const small = (p) => {
      if (policy.order !== 'small-first') return 0;
      const b = batches[batchOf.get(p)];
      return [...b.files].filter((x) => queued.has(x)).reduce((n, x) => n + byPath.get(x).d, 0) <= SMALL_S ? 0 : 1;
    };
    const bat = q.filter(inBatch).sort((a, b) => small(a) - small(b) || batchIdx(a) - batchIdx(b) || lpt(a, b));
    const edit = q.filter((p) => !inBatch(p) && byPath.get(p).cls === 'E').sort(shortest);
    const rest = q.filter((p) => !inBatch(p) && byPath.get(p).cls !== 'E').sort(shortest);
    if (policy.order === 'edit-first') {
      const ownE = q.filter((p) => byPath.get(p).own).sort(shortest);
      return [...ownE, ...bat.filter((p) => !ownE.includes(p)), ...edit.filter((p) => !ownE.includes(p)), ...rest];
    }
    return [...bat, ...edit, ...rest];
  }

  function openWait(w) {
    waits.push(w);
    const fresh = w.files.filter((p) => queued.has(p) && !batchOf.has(p));
    if (fresh.length) {
      const b = { id: batches.length, files: new Set(fresh), at: w.at };
      batches.push(b);
      for (const p of fresh) batchOf.set(p, b.id);
      const sum = fresh.reduce((n, p) => n + byPath.get(p).d, 0);
      const busy = flights.some((fl) => !fl.closed && fl.kind === 'batch');
      if (policy.smallBeside && policy.mode === 'tiers' && busy && sum <= SMALL_S) startTier(fresh, 'beside', fresh.length, b);
    }
  }

  const named = files.filter((f) => f.cls === 'N').map((f) => f.path);
  const reactive = plan.reactive ?? null;
  const agents = new Map(); // name -> { next, open }
  if (reactive) for (const a of reactive) agents.set(a.name, { ...a, next: a.firstAt, open: null });

  for (let guard = 0; guard < 200000; guard++) {
    // 1. Flights and slots that end now.
    for (const fl of flights) {
      if (fl.closed) continue;
      if (policy.mode === 'slots') {
        for (const x of fl.files) if (!done.has(x.f.path) && x.end <= now) done.set(x.f.path, x.end);
        if (fl.files.every((x) => done.has(x.f.path))) fl.closed = true;
      } else if (fl.end <= now) {
        for (const x of fl.files) done.set(x.f.path, fl.end);
        fl.closed = true;
        if (fl.kind !== 'beside') laneFreeAt = Math.max(laneFreeAt, fl.end);
      }
    }
    // 2. Arrivals (an edit queues files; maybe a wait names them).
    while (pendingArrivals.length && pendingArrivals[0].at <= now) {
      const a = pendingArrivals.shift();
      for (const f of a.files) {
        byPath.set(f.path, { ...f });
        queued.add(f.path);
        done.delete(f.path);
      }
      if (a.wait) openWait({ at: now, until: now + 60, files: a.files.map((f) => f.path), agent: 'arrival' });
      const running = flights.find((fl) => !fl.closed && fl.kind === 'batch');
      if (policy.mode === 'tiers' && running && a.files.some((f) => f.cls === 'E')) {
        if (policy.onEdit === 'beside') {
          // Beside: the edit's files run at once on extra workers, one per file.
          startTier(a.files.map((f) => f.path), 'beside', a.files.length);
        } else if (policy.onEdit === 'cancel') {
          for (const x of running.files) {
            if (x.end <= now) done.set(x.f.path, now);
            else {
              if (x.start < now) discarded += now - x.start;
              queued.add(x.f.path);
            }
          }
          running.closed = true;
          running.cancelled = now;
          cuts += 1;
          laneFreeAt = now;
          editPriority = true;
        }
      }
    }
    // 3. Recorded waits that open now, and reactive agents.
    while (pendingWaits.length && pendingWaits[0].at <= now) openWait(pendingWaits.shift());
    for (const a of agents.values()) {
      if (a.open && (now >= a.open.until || a.open.files.every((p) => done.has(p)))) {
        a.next = now + a.gap;
        a.open = null;
      }
      if (a.open || now < a.next) continue;
      const left = a.files.filter((p) => !done.has(p));
      if (!left.length) { a.next = Infinity; continue; }
      a.open = { at: now, until: now + a.wait, files: left, agent: a.name };
      openWait(a.open);
    }
    // 4. Start work.
    if (policy.mode === 'slots') {
      for (let i = 0; i < W; i++) {
        if (freeWorkers[i] > now) continue;
        const next = slotOrder()[0];
        if (!next) break;
        queued.delete(next);
        const f = byPath.get(next);
        const start = now + OVERHEAD_S;
        freeWorkers[i] = start + f.d;
        flights.push({ files: [{ f, start, end: start + f.d }], end: start + f.d, kind: 'slot', start: now });
      }
    } else {
    // A second instance runs the edit's work beside the batch, one tier at a time (`editBeside`).
    const queuedEdit = () => [...queued].filter((p) => byPath.get(p).cls === 'E').sort(shortest);
    if (policy.editBeside && !flights.some((fl) => !fl.closed && fl.kind === 'beside') && queuedEdit().length) {
      startTier(editTier(queuedEdit()), 'beside', TIER_SIZE);
    }
    if (laneFreeAt <= now && !flights.some((fl) => !fl.closed && fl.kind !== 'beside')) {
      if (editPriority) {
        editPriority = false;
        const e = editTier([...queued].filter((p) => byPath.get(p).cls === 'E').sort(shortest));
        if (e.length) startTier(e, 'edit');
      }
      if (!flights.some((fl) => !fl.closed && fl.kind !== 'beside')) {
        const t = selectTiers();
        if (t) laneFreeAt = t.end;
      }
    }
    }
    // 5. Stop when everything is done or nothing can happen.
    const allDone = [...byPath.keys()].every((p) => done.has(p)) && !pendingArrivals.length;
    if (allDone || now > limit) break;
    // 6. Next event.
    const cands = [];
    for (const fl of flights) if (!fl.closed) {
      if (policy.mode === 'slots') for (const x of fl.files) { if (!done.has(x.f.path)) cands.push(x.end); }
      else cands.push(fl.end);
    }
    if (pendingWaits.length) cands.push(pendingWaits[0].at);
    if (pendingArrivals.length) cands.push(pendingArrivals[0].at);
    for (const w of waits) if (w.until > now) cands.push(w.until);
    for (const a of agents.values()) { if (a.open) cands.push(a.open.until); else if (a.next > now) cands.push(a.next); }
    if (laneFreeAt > now) cands.push(laneFreeAt);
    for (const t of freeWorkers) if (t > now) cands.push(t);
    const next = Math.min(...cands.filter((t) => t > now));
    if (!Number.isFinite(next)) break;
    now = next;
  }
  const at = (paths) => (paths.length && paths.every((p) => done.has(p)) ? Math.max(...paths.map((p) => done.get(p))) : null);
  return {
    verdictAt: at(named),
    ownAt: at([...byPath.values()].filter((f) => f.own).map((f) => f.path)),
    allAt: at([...byPath.keys()]),
    done,
    discarded,
    cuts,
    tiers: log,
  };
}
