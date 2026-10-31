// Throwaway (018-01). Estimates which test files keep their Squeal key
// from one commit to another, from git and a COPY of the store only; it
// runs no test and opens the copy read-only.
//
// A test file's key is sha256(environment hash, project, path, (path, blob)
// over its closure) (decision 0002). This script approximates it:
//   closure  = the file's `test_files.closure_paths` as the store holds it
//              now (declared inputs and absent resolution candidates
//              included), applied to both commits: a closure that changed
//              shape over the window is not modelled;
//   env      = blobs of vitest.config.ts, the globalSetup file and its
//              relative imports (a regex walk at the newer commit), the
//              lines of KEY_FORMAT_VERSION and VITEST_ADAPTER_VERSION;
//              pnpm-lock.yaml is reported apart, since since row 011-85 a
//              lockfile change re-keys only the files whose packages moved.
// Node, platform and the CI variable are taken equal on both sides (one CI
// image); whether they are equal across machines is topic result-import.
//
// Usage: node same-key.mjs <repo> <store copy> <pairs.json> [times.json]
//   pairs.json: [{ "label": "...", "from": "<sha>", "to": "<sha>",
//                  "files": ["test/x.test.ts", ...] (optional) }]
//   Output: one JSON line per pair.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [repo, storePath, pairsPath, timesPath] = process.argv.slice(2);
const pairs = JSON.parse(readFileSync(pairsPath, "utf8"));
const times = timesPath === undefined ? {} : JSON.parse(readFileSync(timesPath, "utf8"));

const db = new DatabaseSync(storePath, { readOnly: true });
const closures = new Map();
for (const row of db.prepare("select path, closure_paths from test_files where project = ''").all()) {
  closures.set(row.path, JSON.parse(row.closure_paths));
}
db.close();

const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const trees = new Map();
function tree(sha) {
  let t = trees.get(sha);
  if (t !== undefined) return t;
  t = new Map();
  for (const line of git("ls-tree", "-r", "--full-tree", sha).split("\n")) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m !== null) t.set(m[2], m[1]);
  }
  trees.set(sha, t);
  return t;
}
const show = (sha, path) => {
  const blob = tree(sha).get(path);
  return blob === undefined ? "" : git("cat-file", "-p", blob);
};

function setupClosure(sha) {
  const seen = new Set();
  const todo = ["test/global-teardown.ts"];
  while (todo.length > 0) {
    const path = todo.pop();
    if (seen.has(path) || !tree(sha).has(path)) continue;
    seen.add(path);
    const dir = path.split("/").slice(0, -1).join("/");
    for (const m of show(sha, path).matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
      const parts = `${dir}/${m[1]}`.replace(/\.js$/, ".ts").split("/");
      const out = [];
      for (const p of parts) {
        if (p === "..") out.pop();
        else if (p !== ".") out.push(p);
      }
      todo.push(out.join("/"));
    }
  }
  return [...seen].sort();
}

function envOf(sha, setup) {
  const line = (path, re) => (show(sha, path).match(re) ?? [""])[0];
  return JSON.stringify([
    ["vitest.config.ts", setup].flat().map((p) => [p, tree(sha).get(p) ?? null]),
    line("src/core/keys/key-format.ts", /KEY_FORMAT_VERSION = \d+/),
    line("src/runners/vitest/version.ts", /VITEST_ADAPTER_VERSION = "[^"]*"/),
  ]);
}

const isTest = (p) => /^(test|src)\/.*\.test\.ts$/.test(p) && !p.startsWith("test/fixtures/");

for (const pair of pairs) {
  const a = tree(pair.from);
  const b = tree(pair.to);
  // NO_SETUP=1: leave the globalSetup closure out of env, to show what it alone costs.
  const setup = process.env.NO_SETUP === "1" ? [] : setupClosure(pair.to);
  const envSame = envOf(pair.from, setup) === envOf(pair.to, setup);
  const lockSame = a.get("pnpm-lock.yaml") === b.get("pnpm-lock.yaml");
  const files = pair.files ?? [...b.keys()].filter(isTest);
  const out = { label: pair.label, from: pair.from.slice(0, 9), to: pair.to.slice(0, 9), envSame, lockSame };
  const n = { same: 0, changed: 0, new: 0, noClosure: 0, e2e: 0 };
  const ms = { same: 0, changed: 0, new: 0, noClosure: 0, e2e: 0 };
  const perFile = {};
  for (const file of files) {
    let kind;
    if (file.startsWith("test/e2e/")) kind = "e2e";
    else if (!a.has(file)) kind = "new";
    else if (!closures.has(file)) kind = "noClosure";
    else {
      const paths = new Set([file, ...closures.get(file)]);
      const moved = [...paths].some((p) => (a.get(p) ?? null) !== (b.get(p) ?? null));
      kind = envSame && !moved ? "same" : "changed";
    }
    n[kind]++;
    ms[kind] += times[file] ?? 0;
    perFile[file] = kind;
  }
  out.counts = n;
  out.seconds = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, Math.round(v / 1000)]));
  if (pair.files !== undefined) out.perFile = perFile;
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
