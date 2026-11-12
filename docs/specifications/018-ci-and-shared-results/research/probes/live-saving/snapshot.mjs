// Throwaway probe (row 018-45): one read-only snapshot of squawk's (cezar's)
// Squeal stores, taken once a day for a week.
//
// Usage: node snapshot.mjs <out-dir> [--since <iso>] [--repo <path>]...
//   <out-dir>  where the snapshot goes, as <out-dir>/<UTC time>.json; the
//              newest earlier snapshot there gives the start of the local-run
//              window and the daemon versions seen before
//   --since    start of the local-run window (default: the previous
//              snapshot's takenAt, else 24 h before now)
//   --repo     a main checkout to read (default ~/projects/cezar); its
//              worktrees are the checkouts under <repo>/.ai/cezar/worktrees/*
//              (cezar's) and <repo>/.claude/worktrees/* (Claude Code's).
//              Other git worktrees of the repository are left out; their
//              runs still show under otherWorktreeRuns.
//
// Read-only. The store is opened with `readOnly: true` inside one read
// transaction; files are only read. It imports no child_process: it runs no
// git, no squeal, and starts or stops no daemon. Node built-ins only.
//
// Per worktree it records: the test files listed now, split by the origin of
// their current states (imported, with import id; local: own or inherited;
// mixed), the files not current, each import adoption by revision (start or a
// change, and whether the change reached the file's static closure), the
// daemon's Squeal version, and the local runs that ended in the window
// (file-seconds from each run's report.json, or from the run's surviving
// result rows for node:test runs, which keep none).
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const started = Date.now();
const DEADLINE = started + 110_000; // the brief's limit is 2 minutes

const args = process.argv.slice(2);
const outDir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!outDir) {
  console.error("usage: node snapshot.mjs <out-dir> [--since <iso>] [--repo <path>]...");
  process.exit(1);
}
const flag = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const repos = flag("--repo").length ? flag("--repo") : [join(homedir(), "projects/cezar")];

// --- previous snapshot -------------------------------------------------------
const previousName = existsSync(outDir)
  ? readdirSync(outDir)
      .filter((f) => /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.json$/.test(f))
      .sort()
      .at(-1)
  : undefined;
const previous = previousName ? JSON.parse(readFileSync(join(outDir, previousName), "utf8")) : undefined;
const sinceIso = flag("--since")[0] ?? previous?.takenAt ?? new Date(started - 24 * 3600_000).toISOString();
const since = Date.parse(sinceIso);
if (Number.isNaN(since)) throw new Error(`bad --since: ${sinceIso}`);

// --- checkouts, by reading .git files only -----------------------------------
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
function commonDirOf(checkout) {
  const dotGit = join(checkout, ".git");
  if (!existsSync(dotGit)) return undefined;
  if (statSync(dotGit).isDirectory()) return real(dotGit);
  const gitdir = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
  if (!gitdir) return undefined;
  const abs = resolve(checkout, gitdir);
  const common = join(abs, "commondir");
  return real(existsSync(common) ? resolve(abs, readFileSync(common, "utf8").trim()) : abs);
}
const checkouts = new Map(); // realpath -> commonDir
for (const repo of repos) {
  const candidates = [repo];
  for (const sub of [".ai/cezar/worktrees", ".claude/worktrees"]) {
    const wtDir = join(repo, sub);
    if (existsSync(wtDir)) for (const d of readdirSync(wtDir)) candidates.push(join(wtDir, d));
  }
  for (const c of candidates) {
    const common = commonDirOf(c);
    if (common) checkouts.set(real(c), common);
  }
}
const stores = new Map(); // commonDir -> checkout roots
for (const [root, common] of checkouts) {
  const list = stores.get(common) ?? [];
  list.push(root);
  stores.set(common, list);
}

// --- one store ---------------------------------------------------------------
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

function readStore(commonDir, roots) {
  const path = join(commonDir, "squeal/store.sqlite");
  if (!existsSync(path)) return { commonDir, store: null, checkouts: roots.sort() };
  const db = new DatabaseSync(path, { readOnly: true, timeout: 10_000 });
  db.exec("BEGIN"); // one consistent read of the live store
  try {
    return readStoreTx(db, commonDir, path, roots);
  } finally {
    db.exec("COMMIT");
    db.close();
  }
}

function readStoreTx(db, commonDir, path, roots) {
  const readAt = Date.now();
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  // Imports present.
  const ciEnv = new Map(
    all("select hash, json_extract(descriptor, '$.ci') ci from environments").map((r) => [r.hash, r.ci]),
  );
  const importFiles = db.prepare("select environment e, count(*) n from import_files where import_id = ? group by 1");
  const imports = all("select id, header, imported_at at from imports order by imported_at").map((i) => {
    const h = JSON.parse(i.header);
    let files = 0;
    let atCiKey = 0;
    let unknownEnvironment = 0;
    for (const e of importFiles.all(i.id)) {
      files += e.n;
      const c = ciEnv.get(e.e);
      if (c === undefined || c === null) unknownEnvironment += e.n;
      else if (c === 1 || c === true || c === "true") atCiKey += e.n;
    }
    return {
      id: i.id,
      commit: h.commit,
      createdAt: iso(h.createdAt),
      importedAt: iso(i.at),
      ciSquealVersion: h.squealVersion,
      keyFormat: h.keyFormat,
      source: h.source ? { runId: h.source.runId, event: h.source.event, ref: h.source.ref } : null,
      files,
      filesAtCiKey: atCiKey,
      filesRekeyed: files - atCiKey - unknownEnvironment,
      filesUnknownEnvironment: unknownEnvironment,
      newSincePreviousSnapshot: previous ? i.at >= Date.parse(previous.takenAt) : null,
    };
  });

  // Static closures, to tell a change's adoption from a start's.
  const closures = new Map(
    all("select project, path, closure_paths cp from test_files").map((r) => [
      `${r.project}\0${r.path}`,
      new Set(JSON.parse(r.cp)),
    ]),
  );

  // Local runs that ended in the window, all worktrees (removed ones too).
  const runs = all(
    "select id, worktree_id wt, revision rev, started_at s, ended_at e, end_state es, checkpoint_id cp, log_dir dir from runs where ended_at >= ? and ended_at < ?",
    since,
    readAt,
  );
  const inProgress = new Map(
    all("select worktree_id wt, count(*) n from runs where ended_at is null and started_at >= ? group by 1", since).map(
      (r) => [r.wt, r.n],
    ),
  );
  const resultFiles = db.prepare(
    "select r.duration_ms ms from results r join checks c on c.id = r.check_id where r.run_id = ? and c.kind = 'file'",
  );
  const runsByWorktree = new Map();
  let reportsSkipped = 0;
  for (const r of runs) {
    let durations = null;
    let source = "report";
    if (Date.now() > DEADLINE) reportsSkipped++;
    else {
      try {
        const rep = JSON.parse(readFileSync(join(r.dir, "report.json"), "utf8"));
        durations = (rep.report?.fileDurations ?? []).map((d) => d.durationMs);
      } catch {
        // node:test runs keep no report.json; a later run at the same key
        // replaces a result row, so this undercounts.
        durations = resultFiles.all(r.id).map((x) => x.ms);
        source = "results";
      }
    }
    const list = runsByWorktree.get(r.wt) ?? [];
    list.push({ ...r, durations, source });
    runsByWorktree.set(r.wt, list);
  }
  const summarizeRuns = (list, daemon) => {
    const o = {
      runs: 0,
      fileRuns: 0,
      fileSec: 0,
      checkpointFileSec: 0,
      fromResultRowsFileSec: 0,
      wallSec: 0,
      endStates: {},
      fileSecByDaemonVersion: {},
      runsWithoutDurations: 0,
    };
    for (const r of list ?? []) {
      o.runs++;
      o.wallSec += (r.e - r.s) / 1000;
      o.endStates[r.es ?? "null"] = (o.endStates[r.es ?? "null"] ?? 0) + 1;
      if (!r.durations) {
        o.runsWithoutDurations++;
        continue;
      }
      const s = r.durations.reduce((a, b) => a + b, 0) / 1000;
      o.fileRuns += r.durations.length;
      o.fileSec += s;
      if (r.cp) o.checkpointFileSec += s;
      if (r.source === "results") o.fromResultRowsFileSec += s;
      const v = daemon ? versionAt(daemon, r.s) : "unknown";
      o.fileSecByDaemonVersion[v] = (o.fileSecByDaemonVersion[v] ?? 0) + s;
    }
    for (const k of ["fileSec", "checkpointFileSec", "fromResultRowsFileSec", "wallSec"]) o[k] = Math.round(o[k]);
    for (const k of Object.keys(o.fileSecByDaemonVersion))
      o.fileSecByDaemonVersion[k] = Math.round(o.fileSecByDaemonVersion[k]);
    return o;
  };

  // Worktrees.
  const rows = all(
    "select id, root, is_main, registered_at reg, daemon_version v, daemon_started_at ds, daemon_heartbeat_at hb, daemon_heartbeat_interval_ms hbi from worktrees",
  );
  const byRoot = new Map(rows.map((w) => [real(w.root), w]));
  const prevWorktrees = new Map(
    (previous?.stores ?? []).flatMap((s) => (s.worktrees ?? []).filter((w) => w.id).map((w) => [w.id, w])),
  );
  const listed = db.prepare("select project, path from test_file_keys where worktree_id = ?");
  const states = db.prepare(`
    select c.project, c.test_path path, c.kind, k.validity, k.origin_kind ok, k.origin_worktree ow,
      k.observed_at rev, k.duration_ms ms
    from known_states k join checks c on c.id = k.check_id where k.worktree_id = ?`);
  const revisions = db.prepare("select number, created_at at, head, trigger, changes from revisions where worktree_id = ?");

  const worktrees = [];
  for (const root of roots.sort()) {
    const w = byRoot.get(root);
    if (!w) {
      worktrees.push({ root, registered: false });
      continue;
    }
    const prev = prevWorktrees.get(w.id);
    const versionsSeen = [...(prev?.daemon?.versionsSeen ?? [])];
    if (w.v && !versionsSeen.some((x) => x.version === w.v && x.startedAt === iso(w.ds)))
      versionsSeen.push({ version: w.v, startedAt: iso(w.ds) });
    const daemon = {
      version: w.v,
      startedAt: iso(w.ds),
      heartbeatAt: iso(w.hb),
      heartbeatFresh: w.hb != null && readAt - w.hb < 3 * (w.hbi ?? 30_000),
      versionsSeen,
    };

    const revs = new Map(
      revisions.all(w.id).map((r) => [
        r.number,
        { at: r.at, head: r.head, trigger: r.trigger, paths: JSON.parse(r.changes).map((c) => c.path) },
      ]),
    );
    const lastRev = Math.max(-1, ...revs.keys());

    const list = new Set(listed.all(w.id).map((r) => `${r.project}\0${r.path}`));
    const files = new Map();
    for (const s of states.all(w.id)) {
      const id = `${s.project}\0${s.path}`;
      if (list.size && !list.has(id)) continue;
      const f = files.get(id) ?? { current: true, validity: new Set(), origins: new Set(), imports: new Set(), rev: -1, fileMs: null };
      if (s.validity !== "current") {
        f.current = false;
        f.validity.add(s.validity);
      }
      if (s.ok === null && s.ow?.startsWith("import:")) {
        f.origins.add("imported");
        f.imports.add(s.ow.slice("import:".length));
        f.rev = Math.max(f.rev, s.rev ?? 0);
      } else f.origins.add(s.ok ?? "none");
      if (s.kind === "file") f.fileMs = s.ms;
      files.set(id, f);
    }

    const c = {
      listed: list.size,
      withStates: files.size,
      current: 0,
      imported: 0,
      local: 0,
      localOwn: 0,
      localInherited: 0,
      mixed: 0,
      notCurrent: 0,
      notCurrentBy: {},
    };
    const byImport = {};
    const adoptions = new Map(); // import\trev -> agg
    for (const [id, f] of files) {
      if (!f.current) {
        c.notCurrent++;
        const v = [...f.validity].sort().join("+");
        c.notCurrentBy[v] = (c.notCurrentBy[v] ?? 0) + 1;
        continue;
      }
      c.current++;
      const only = f.origins.size === 1 ? [...f.origins][0] : "mixed";
      if (only === "imported" && f.imports.size === 1) {
        c.imported++;
        const imp = [...f.imports][0];
        const b = (byImport[imp] ??= { files: 0, ciFileSec: 0 });
        b.files++;
        b.ciFileSec += (f.fileMs ?? 0) / 1000;
        const rv = revs.get(f.rev);
        const closure = closures.get(id);
        const reached = rv && rv.trigger !== "start" && closure ? rv.paths.some((p) => closure.has(p)) : false;
        const k = `${imp}\t${f.rev}`;
        const a = adoptions.get(k) ?? {
          import: imp,
          revision: f.rev,
          revisionAt: iso(rv?.at),
          trigger: rv?.trigger ?? null,
          files: 0,
          reachedByChange: 0,
          reachedCiFileSec: 0,
        };
        a.files++;
        if (reached) {
          a.reachedByChange++;
          a.reachedCiFileSec += (f.fileMs ?? 0) / 1000;
        }
        adoptions.set(k, a);
      } else if (only === "own") {
        c.local++;
        c.localOwn++;
      } else if (only === "inherited") {
        c.local++;
        c.localInherited++;
      } else c.mixed++;
    }
    for (const b of Object.values(byImport)) b.ciFileSec = Math.round(b.ciFileSec);
    worktrees.push({
      root,
      registered: true,
      id: w.id,
      isMain: Boolean(w.is_main),
      registeredAt: iso(w.reg),
      daemon,
      lastRecordedRevision: lastRev, // -1: no revisions row, only the start's revision 0
      head: revs.get(lastRev)?.head ?? null,
      files: c,
      byImport,
      adoptions: [...adoptions.values()]
        .map((a) => ({ ...a, reachedCiFileSec: Math.round(a.reachedCiFileSec) }))
        .sort((a, b) => a.revision - b.revision || a.import.localeCompare(b.import)),
      localRuns: summarizeRuns(runsByWorktree.get(w.id), daemon),
      runsInProgress: inProgress.get(w.id) ?? 0,
    });
    runsByWorktree.delete(w.id);
  }

  // Runs from worktrees that are no longer checkouts here (removed, or rows gone).
  const other = [...runsByWorktree].map(([id, list]) => {
    const w = rows.find((r) => r.id === id);
    const prev = prevWorktrees.get(id);
    return {
      id,
      root: w?.root ?? prev?.root ?? null,
      lastKnownDaemonVersion: w?.v ?? prev?.daemon?.version ?? null,
      localRuns: summarizeRuns(list, prev?.daemon),
    };
  });

  return {
    commonDir,
    store: path,
    readAt: iso(readAt),
    worktreesInStore: rows.length,
    imports,
    importsGoneSincePreviousSnapshot: (previous?.stores ?? [])
      .find((s) => s.commonDir === commonDir)
      ?.imports?.map((i) => i.id)
      .filter((id) => !imports.some((i) => i.id === id)) ?? [],
    worktrees,
    otherWorktreeRuns: other,
    reportsSkippedForTime: reportsSkipped,
  };
}

// Version of the daemon that started a run: the current daemon's from its
// start, else the newest earlier start seen in a previous snapshot.
function versionAt(daemon, startedAtMs) {
  const seen = [...(daemon.versionsSeen ?? [])]
    .filter((x) => x.startedAt)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return seen.find((x) => Date.parse(x.startedAt) <= startedAtMs)?.version ?? "unknown";
}

const snapshot = {
  probe: "018-45 snapshot.mjs",
  takenAt: new Date(started).toISOString(),
  since: new Date(since).toISOString(),
  sinceFrom: flag("--since")[0] ? "argument" : previous ? `previous snapshot ${previousName}` : "24 h before takenAt",
  node: process.version,
  host: { loadavg: loadavg().map((x) => Math.round(x * 10) / 10) },
  stores: [...stores].map(([common, roots]) => readStore(common, roots)),
};
snapshot.elapsedMs = Date.now() - started;
const name = `${snapshot.takenAt.slice(0, 19).replaceAll(":", "-")}Z.json`;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, name), `${JSON.stringify(snapshot, null, 1)}\n`);
const totals = snapshot.stores.flatMap((s) => s.worktrees ?? []).filter((w) => w.registered);
console.log(
  `${join(outDir, name)}: ${snapshot.stores.length} store(s), ${totals.length} registered checkouts, ` +
    `${totals.reduce((a, w) => a + w.files.imported, 0)} imported / ${totals.reduce((a, w) => a + w.files.local, 0)} local current files, ` +
    `${totals.reduce((a, w) => a + w.localRuns.fileSec, 0)} local file-s since ${snapshot.since}, ${snapshot.elapsedMs} ms`,
);
