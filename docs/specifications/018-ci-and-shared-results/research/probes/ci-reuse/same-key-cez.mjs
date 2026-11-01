// Throwaway (018-04). For cezarion: which test files keep their Squeal key
// from one commit to the next, from git and a COPY of the store only. Runs no
// test; opens the copy read-only. Extends probes/ci-run/same-key.mjs:
//   closure  = test_files.closure_paths as the store holds it now (it already
//              holds the observed reads); a path ending in "/" is a listed
//              directory and hashes as its entry names (Listings in
//              src/core/keys/observed.ts), taken from the git tree;
//   env      = per project, blobs of the root vitest.config.ts, the project's
//              config, its setup and globalSetup files, and their relative
//              imports (a regex walk at the newer commit);
//   lockfile = pnpm-lock.yaml. Since row 011-85 a lockfile change re-keys only
//              the files whose packages moved; that is not modelled. LOCK=all
//              re-keys every file of the pair (upper bound), LOCK=none ignores
//              it (lower bound, the default).
//   E2E_IGNORE_TESTS=1  a what-if for cezarion's own config: browser files
//              ignore changed unit-test files (*.test.ts(x), *.testkit.ts,
//              __snapshots__/), which today reach them only through the broad
//              declared `inputs` globs in its squeal.config.json.
// Node, platform, CI, coverage options and the Squeal release are taken equal
// on both sides (one CI image, one command). Coverage is not equal today:
// PR shards pass --coverage.enabled and main does not (see ci-reuse.md Q2).
//
// Usage: node same-key-cez.mjs <repo> <store copy> <pairs.json> <times.json>
//   pairs.json: [{ "label", "from", "to" }]; times.json from file-times.mjs.
//   Output: one JSON line per pair, then one line {"rekeyedBy": ...}.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const [repo, storePath, pairsPath, timesPath] = process.argv.slice(2);
const pairs = JSON.parse(readFileSync(pairsPath, "utf8"));
const times = JSON.parse(readFileSync(timesPath, "utf8"));
const LOCK = process.env.LOCK ?? "none";

const projects = {
  server: { root: "packages/cezar", test: /^packages\/cezar\/src\/.*\.test\.ts$/, config: "packages/cezar/vitest.config.ts", setup: ["packages/cezar/vitest.setup.ts"] },
  web: { root: "packages/web", test: /^packages\/web\/src\/.*\.test\.tsx?$/, config: "packages/web/vitest.config.ts", setup: ["packages/web/vitest.setup.ts", "packages/web/vite.config.ts"] },
  contract: { root: "packages/contract", test: /^packages\/contract\/src\/.*\.test\.ts$/, config: "packages/contract/vitest.config.ts", setup: [] },
  "api-client": { root: "packages/api-client", test: /^packages\/api-client\/src\/.*\.test\.ts$/, config: "packages/api-client/vitest.config.ts", setup: [] },
  e2e: {
    root: "packages/web/e2e", test: /^packages\/web\/e2e\/.*\.e2e\.ts$/, config: "packages/web/e2e/vitest.config.ts",
    setup: ["scripts/test-git-env.mjs", "packages/web/e2e/fetch-setup.mjs", "packages/web/e2e/failure-setup.ts", "packages/web/e2e/environment.ts", ".github/scripts/cockpit-test-sequencer.mjs"],
  },
};

const db = new DatabaseSync(storePath, { readOnly: true });
const closures = new Map();
for (const row of db.prepare("select project, path, closure_paths from test_files").all()) {
  if (projects[row.project] !== undefined) closures.set(row.path, { project: row.project, paths: JSON.parse(row.closure_paths) });
}
db.close();

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const trees = new Map();
function tree(sha) {
  let t = trees.get(sha);
  if (t !== undefined) return t;
  t = { blobs: new Map(), listings: null };
  for (const line of git("ls-tree", "-r", "--full-tree", sha).split("\n")) {
    const m = /^\d+ (?:blob|commit) ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m !== null) t.blobs.set(m[2], m[1]);
  }
  trees.set(sha, t);
  return t;
}
function listing(sha, dir) {
  const t = tree(sha);
  if (t.listings === null) {
    t.listings = new Map();
    for (const path of t.blobs.keys()) {
      const parts = path.split("/");
      for (let i = 0; i < parts.length; i++) {
        const d = parts.slice(0, i).join("/");
        let s = t.listings.get(d);
        if (s === undefined) t.listings.set(d, (s = new Set()));
        s.add(parts[i]);
      }
    }
  }
  const names = t.listings.get(dir);
  return names === undefined ? "absent" : createHash("sha1").update([...names].sort().join("\0")).digest("hex");
}
const hashOf = (sha, path) => (path.endsWith("/") ? listing(sha, path === "./" ? "" : path.slice(0, -1)) : tree(sha).blobs.get(path) ?? null);
const show = (sha, path) => {
  const blob = tree(sha).blobs.get(path);
  return blob === undefined ? "" : git("cat-file", "-p", blob);
};
function resolve(sha, from, spec) {
  const dir = from.split("/").slice(0, -1).join("/");
  const out = [];
  for (const p of `${dir}/${spec}`.split("/")) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  const base = out.join("/");
  const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, `${base}/index.ts`];
  return candidates.find((c) => tree(sha).blobs.has(c)) ?? null;
}
function walk(sha, starts) {
  const seen = new Set();
  const todo = [...starts];
  while (todo.length > 0) {
    const path = todo.pop();
    if (path === null || seen.has(path) || !tree(sha).blobs.has(path)) continue;
    seen.add(path);
    for (const m of show(sha, path).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) todo.push(resolve(sha, path, m[1]));
  }
  return [...seen].sort();
}
const envPaths = new Map();
function envFiles(sha, project) {
  const k = `${sha}|${project}`;
  if (!envPaths.has(k)) envPaths.set(k, walk(sha, ["vitest.config.ts", projects[project].config, ...projects[project].setup]));
  return envPaths.get(k);
}

const rekeyedBy = new Map(); // path -> { pairs, files, seconds }
const projectOf = (file) => Object.keys(projects).find((p) => projects[p].test.test(file));

for (const pair of pairs) {
  const a = tree(pair.from).blobs;
  const b = tree(pair.to).blobs;
  const lockSame = a.get("pnpm-lock.yaml") === b.get("pnpm-lock.yaml");
  const envChanged = {};
  for (const project of Object.keys(projects)) {
    const files = envFiles(pair.to, project);
    envChanged[project] = files.filter((p) => (a.get(p) ?? null) !== (b.get(p) ?? null));
  }
  const res = { unit: { same: 0, changed: 0, new: 0, noClosure: 0 }, e2e: { same: 0, changed: 0, new: 0, noClosure: 0 } };
  const sec = { unit: { same: 0, changed: 0, new: 0, noClosure: 0 }, e2e: { same: 0, changed: 0, new: 0, noClosure: 0 } };
  const perPath = new Map();
  const maxRun = { unit: 0, e2e: 0 }; // the longest file that still runs, ms
  const changedPaths = [...new Set([...a.keys(), ...b.keys()])].filter((p) => (a.get(p) ?? null) !== (b.get(p) ?? null));
  for (const file of [...b.keys()].filter((f) => projectOf(f) !== undefined)) {
    const project = projectOf(file);
    const group = project === "e2e" ? "e2e" : "unit";
    const ms = times[file]?.ms ?? 0;
    let kind;
    const c = closures.get(file);
    if (!a.has(file)) kind = "new";
    else if (c === undefined) kind = "noClosure";
    else {
      const ignored = (p) => process.env.E2E_IGNORE_TESTS === "1" && project === "e2e" && /\.test\.tsx?$|\.testkit\.ts$|__snapshots__\//.test(p);
      const moved = [...new Set([file, ...c.paths])].filter((p) => !ignored(p) && hashOf(pair.from, p) !== hashOf(pair.to, p));
      const causes = [...moved, ...envChanged[project].map((p) => `env:${p}`), ...(LOCK === "all" && !lockSame ? ["pnpm-lock.yaml"] : [])];
      kind = causes.length === 0 ? "same" : "changed";
      for (const cause of causes) {
        const e = perPath.get(cause) ?? { files: 0, ms: 0 };
        e.files++;
        e.ms += ms;
        perPath.set(cause, e);
      }
    }
    if (kind !== "same") maxRun[group] = Math.max(maxRun[group], ms);
    res[group][kind]++;
    sec[group][kind] += ms;
  }
  for (const [path, e] of perPath) {
    const r = rekeyedBy.get(path) ?? { pairs: 0, files: 0, seconds: 0 };
    r.pairs++;
    r.files += e.files;
    r.seconds += e.ms / 1000;
    rekeyedBy.set(path, r);
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / 1000)]));
  process.stdout.write(
    `${JSON.stringify({
      label: pair.label, from: pair.from.slice(0, 9), to: pair.to.slice(0, 9), lockSame,
      changedPaths: changedPaths.length,
      envChanged: Object.fromEntries(Object.entries(envChanged).filter(([, v]) => v.length > 0)),
      counts: res, maxRunSeconds: round(maxRun), seconds: { unit: round(sec.unit), e2e: round(sec.e2e) },
    })}\n`,
  );
}
const top = [...rekeyedBy].sort((x, y) => y[1].seconds - x[1].seconds).slice(0, 25);
process.stdout.write(`${JSON.stringify({ rekeyedBy: top.map(([p, r]) => ({ path: p, ...r, seconds: Math.round(r.seconds) })) })}\n`);
