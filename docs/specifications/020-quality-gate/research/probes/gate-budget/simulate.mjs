// Throwaway (row 020-41): a list-scheduling model of budget rules on #196's numbers.
// A model, not a run: every file of a group costs the same; no contention between runners.
// node simulate.mjs > simulate.out.json
//
// Case A (#196 report): 431 s left; node:test 1 file (stored 207 s, real 311 s on the retry (0.1.447 comment),
//   over 431 s in the report; 700 stands for "did not finish in either budget"); Vitest 1,232 files, estimate 2,114 s at 5 wide, so 8.58 s a file.
// Case B (#196 comment, 0.1.447): 492 s left; node:test only, 151 files, estimate 343 s at 4 wide.
//   Entry 1 holds the launcher and 11 quick files; the other 139 files are in later entries.
//   Quick files cost (343*4 - 207) / 150 = 7.77 s each.

const cases = {
  A: {
    left: 431,
    lanes: {
      node: { width: 4, entries: [[{ name: "launcher", stored: 207 }]] },
      vitest: { width: 5, entries: [Array.from({ length: 1232 }, () => ({ stored: 8.58 }))] },
    },
    estimates: { node: 207, vitest: 2114 },
  },
  B: {
    left: 492,
    lanes: {
      node: {
        width: 4,
        entries: [
          [{ name: "launcher", stored: 207 }, ...Array.from({ length: 11 }, () => ({ stored: 7.77 }))],
          Array.from({ length: 139 }, () => ({ stored: 7.77 })),
        ],
      },
    },
    estimates: { node: 343 },
  },
};

/** Runs `files` (real seconds) `width` at once from `start` until `end`; returns completions and stopped work. */
function pool(files, width, start, end, cap = Infinity) {
  const slots = Array.from({ length: width }, () => start);
  let done = 0;
  let killed = 0;
  let queueEmptyAt = start;
  const finished = [];
  for (const f of files) {
    slots.sort((a, b) => a - b);
    const at = slots[0];
    if (at >= end) break;
    const stop = Math.min(at + f.real, end, at + cap);
    if (stop === at + f.real) {
      done++;
      finished.push(f.name ?? "");
    } else killed += stop - at;
    slots[0] = stop;
    queueEmptyAt = at;
  }
  return { done, killed, last: Math.max(...slots), queueEmptyAt, finished };
}

function real(files, launcher) {
  return files.map((f) => ({ ...f, real: f.name === "launcher" ? launcher : f.stored }));
}

/** R0, today (D18): lanes in estimate order, node:test entries in turn, each run to the deadline. */
function sequential(c, launcher, cap) {
  let t = 0;
  const out = {};
  const order = Object.keys(c.lanes).sort((a, b) => c.estimates[a] - c.estimates[b]);
  for (const lane of order) {
    out[lane] = { done: 0, killed: 0, launcher: false };
    for (const entry of c.lanes[lane].entries) {
      const r = pool(real(entry, launcher), c.lanes[lane].width, t, c.left, cap);
      out[lane].done += r.done;
      out[lane].killed += r.killed;
      out[lane].launcher ||= r.finished.includes("launcher");
      t = Math.min(r.last, c.left);
    }
  }
  return out;
}

/** R1: each lane gets a share of the budget in proportion to its estimate; files running at its end stop. */
function share(c, launcher) {
  const total = Object.values(c.estimates).reduce((a, b) => a + b, 0);
  let t = 0;
  const out = {};
  const order = Object.keys(c.lanes).sort((a, b) => c.estimates[a] - c.estimates[b]);
  for (const lane of order) {
    const end = Math.min(c.left, t + (c.left * c.estimates[lane]) / total);
    out[lane] = { done: 0, killed: 0, launcher: false };
    for (const entry of c.lanes[lane].entries) {
      const r = pool(real(entry, launcher), c.lanes[lane].width, t, end);
      out[lane].done += r.done;
      out[lane].killed += r.killed;
      out[lane].launcher ||= r.finished.includes("launcher");
      t = Math.min(r.last, end);
    }
    t = end;
  }
  return out;
}

/** R3: the lanes at once, as the daemon's lanes run (spec 011); `shared`: node:test entries share one pool. */
function lanesAtOnce(c, launcher, shared) {
  const out = {};
  for (const [lane, { width, entries }] of Object.entries(c.lanes)) {
    const files = entries.flatMap((e) => real(e, launcher));
    if (shared) {
      const r = pool(files, width, 0, c.left);
      out[lane] = { done: r.done, killed: r.killed, launcher: r.finished.includes("launcher") };
    } else {
      let t = 0;
      out[lane] = { done: 0, killed: 0, launcher: false };
      for (const entry of entries) {
        const r = pool(real(entry, launcher), width, t, c.left);
        out[lane].done += r.done;
        out[lane].killed += r.killed;
        out[lane].launcher ||= r.finished.includes("launcher");
        t = Math.min(r.last, c.left);
      }
    }
  }
  return out;
}

const results = [];
for (const [name, c] of Object.entries(cases)) {
  for (const launcher of [311, 700]) {
    results.push({
      case: name,
      launcherReal: launcher,
      rules: {
        "R0 today (in turn)": sequential(c, launcher),
        "R1 share by estimate": share(c, launcher),
        "R2 per-file cap 2x stored": sequential(c, launcher, 2 * 207),
        "R3 lanes at once": lanesAtOnce(c, launcher, false),
        "R4 lanes at once, node:test entries share one pool": lanesAtOnce(c, launcher, true),
      },
    });
  }
}
process.stdout.write(`${JSON.stringify(results, null, 1)}\n`);
