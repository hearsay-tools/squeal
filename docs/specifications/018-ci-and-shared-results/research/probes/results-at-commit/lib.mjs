// Throwaway (results-at-commit): shared helpers for label.mjs and reuse.mjs.
// Reads git objects with read-only git commands and a Squeal store opened
// read-only. Never writes to either.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function gitOf(repo) {
  return (...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
}

/** First-parent main commits, newest first: [{ sha, time }]. */
export function mainCommits(repo, ref, since) {
  const out = gitOf(repo)("log", "--first-parent", `--since=${since}`, "--format=%H %ct", ref);
  return out
    .trim()
    .split("\n")
    .map((line) => {
      const [sha, t] = line.split(" ");
      return { sha, time: Number(t) * 1000 };
    });
}

/** `git ls-tree -r` of a commit as Map(path -> blob), LRU-cached; null when the commit is absent. */
export function treeReader(repo, keep = 64) {
  const git = gitOf(repo);
  const cache = new Map();
  return (sha) => {
    if (cache.has(sha)) {
      const t = cache.get(sha);
      cache.delete(sha);
      cache.set(sha, t);
      return t;
    }
    let out;
    try {
      out = git("ls-tree", "-r", "-z", "--full-tree", sha);
    } catch {
      out = null;
    }
    let t = null;
    if (out !== null) {
      t = new Map();
      for (const entry of out.split("\0")) {
        const tab = entry.indexOf("\t");
        if (tab < 0) continue;
        const [, type, object] = entry.slice(0, tab).split(" ");
        if (type === "blob") t.set(entry.slice(tab + 1), object);
      }
    }
    cache.set(sha, t);
    if (cache.size > keep) cache.delete(cache.keys().next().value);
    return t;
  };
}

/** Each directory's entry names in a tree (as transfer-rekey.ts `entryNames`). */
export function entryNames(tree) {
  const names = new Map();
  for (const path of tree.keys()) {
    let dir = "";
    for (const name of path.split("/")) {
      const held = names.get(dir) ?? new Set();
      held.add(name);
      names.set(dir, held);
      dir = dir === "" ? name : `${dir}/${name}`;
    }
  }
  return names;
}

/**
 * The store's view of each test file's closure: `test_files.closure_paths`
 * plus its entries in the shared observed map, as the daemon assembles them
 * (assembleClosure), node_modules and `.git` left out.
 */
export function storeClosures(storePath) {
  const db = new DatabaseSync(storePath, { readOnly: true });
  db.exec("PRAGMA query_only = 1");
  const observed = new Map();
  for (const row of db.prepare("select key, value from meta where key like 'observed.%'").all()) {
    const project = row.key.slice("observed.".length);
    try {
      observed.set(project, JSON.parse(row.value));
    } catch {}
  }
  const closures = new Map();
  for (const row of db.prepare("select project, path, closure_paths from test_files").all()) {
    const paths = new Set([row.path, ...JSON.parse(row.closure_paths)]);
    for (const p of observed.get(row.project)?.[row.path] ?? []) paths.add(p);
    const kept = [...paths].filter(
      (p) => p !== ".git" && !p.startsWith("node_modules/") && !p.includes("/node_modules/"),
    );
    closures.set(`${row.project}\0${row.path}`, { project: row.project, path: row.path, paths: kept.sort() });
  }
  // Environment runner files per project, from every stored descriptor.
  const envFiles = new Map();
  try {
    for (const row of db.prepare("select descriptor from environments").all()) {
      const d = JSON.parse(row.descriptor);
      const set = envFiles.get(d.project) ?? new Set();
      for (const [p] of d.files ?? []) set.add(p);
      envFiles.set(d.project, set);
    }
  } catch {}
  db.close();
  return { closures, envFiles };
}

/** Files that pin the toolchain or the install, outside every closure. */
export const PIN_FILES = [".node-version", ".nvmrc", ".tool-versions"];
/** The lockfile that describes the install: the first present, pnpm's first (a repository may also keep an unused package-lock.json). */
export const LOCK_FILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "package-lock.json"];

/**
 * A content signature of one test file at one commit, split into parts so a
 * break can be named. Each commit's tree is read once (`git ls-tree`) and
 * kept only over the paths some closure or environment names (`union`), as
 * small integer ids, so thousands of commits fit in memory.
 */
export function signer(readTree, envFiles, closures) {
  const union = new Map();
  const add = (p) => {
    if (!union.has(p)) union.set(p, union.size);
  };
  for (const f of closures.values()) for (const p of f.paths) add(p);
  for (const set of envFiles.values()) for (const p of set) add(p);
  for (const p of [...LOCK_FILES, ...PIN_FILES]) add(p);
  const listings = [...union.keys()].filter((p) => p.endsWith("/"));
  const values = new Map([[null, 0]]);
  const intern = (v) => {
    if (!values.has(v)) values.set(v, values.size);
    return values.get(v);
  };
  const commits = new Map();
  const at = (sha) => {
    if (commits.has(sha)) return commits.get(sha);
    const tree = readTree(sha);
    let row = null;
    if (tree !== null) {
      row = new Uint32Array(union.size);
      for (const [p, id] of union) if (!p.endsWith("/")) row[id] = intern(tree.get(p) ?? null);
      if (listings.length > 0) {
        const names = entryNames(tree);
        for (const p of listings) {
          const held = names.get(p === "./" ? "" : p.slice(0, -1));
          row[union.get(p)] = intern(held === undefined ? null : `names:${[...held].sort().join("/")}`);
        }
      }
    }
    commits.set(sha, row);
    return row;
  };
  const ids = new Map();
  const idsOf = (key, paths) => {
    if (!ids.has(key)) ids.set(key, Uint32Array.from(paths.map((p) => union.get(p))));
    return ids.get(key);
  };
  const h = (row, list) => {
    const hash = createHash("sha1");
    hash.update(Buffer.from(Uint32Array.from(list, (i) => row[i]).buffer));
    return hash.digest("hex");
  };
  return (file, sha) => {
    const row = at(sha);
    if (row === null) return null;
    const env = [...(envFiles.get(file.project) ?? [])].sort();
    return {
      closure: h(row, idsOf(`c\0${file.project}\0${file.path}`, file.paths)),
      env: h(row, idsOf(`e\0${file.project}`, env)),
      lock: (() => {
        const id = idsOf("lock", LOCK_FILES).find((i) => row[i] !== 0);
        return id === undefined ? "none" : h(row, [id]);
      })(),
      pin: h(row, idsOf("pin", PIN_FILES)),
    };
  };
}

export const sameSig = (a, b) =>
  a !== null && b !== null && a.closure === b.closure && a.env === b.env && a.lock === b.lock && a.pin === b.pin;

/** Groups of dump.mjs by `${project}\0${path}`. */
export function readDump(path) {
  const byFile = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line === "") continue;
    const g = JSON.parse(line);
    const id = `${g.p}\0${g.t}`;
    const list = byFile.get(id) ?? [];
    list.push(g);
    byFile.set(id, list);
  }
  return byFile;
}
