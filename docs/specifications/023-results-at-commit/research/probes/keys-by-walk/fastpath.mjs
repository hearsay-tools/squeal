// Throwaway probe (research 023-15, keys-by-walk). Not product code.
//
// Which test files keep their key between the tip and an older commit X without a walk, judged
// from git objects only, against the key inputs a fresh walk at the tip listed (walk.ts DUMP=1).
// Checks each verdict against fresh-walk keys at X when a walk file for X is given.
//
// Usage: [ASKER=<sha>] node fastpath.mjs <clone> <tip walk.json> <label>:<sha>[:<walk at X json>] ...
// Prints one JSON line per target. Reads git with ls-tree, diff and show only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix, matchesGlob } from "node:path";

const [clone, tipWalk, ...targets] = process.argv.slice(2);
const git = (...args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
const tip = JSON.parse(readFileSync(tipWalk, "utf8"));
// ASKER=<sha>: diff from that commit instead of the walked tip, still over the tip's inputs (an
// approximation for askers near the tip; the inputs of older askers were not walked).
const tipSha = process.env.ASKER ?? tip.head;

function tree(sha) {
  const files = new Set(git("ls-tree", "-r", "--name-only", "-z", sha).split("\0").filter(Boolean));
  const names = new Map(); // dir -> Set(entry names)
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!names.has(dir)) names.set(dir, new Set());
      names.get(dir).add(parts[i]);
    }
  }
  return { files, names };
}
const tipTree = tree(tipSha);
// What git held at the walked tip: a path on disk there and not in this tree is untracked.
const walkedTree = tipSha === tip.head ? tipTree : tree(tip.head);
const isPattern = (p) => /[*?{[]/.test(p);
const listed = (p) => (p.endsWith("/") ? (p === "./" ? "" : p.slice(0, -1)) : null);
const stem = (p) => posix.basename(p).replace(/\.[^.]+$/, "");
const MODULE = /\.(m|c)?(t|j)sx?$/;
const RESOLUTION_FIELDS = ["imports", "exports", "main", "module", "browser", "type", "name"];

function sameNames(a, b) {
  if (a === undefined || b === undefined) return a === b;
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}
function resolutionFieldsChanged(sha, path) {
  const read = (rev) => {
    try {
      return JSON.parse(git("show", `${rev}:${path}`));
    } catch {
      return null;
    }
  };
  const a = read(tipSha), b = read(sha);
  if (a === null || b === null) return true;
  return RESOLUTION_FIELDS.some((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

for (const target of targets) {
  const [label, sha, walkAtX] = target.split(":");
  const xTree = tree(sha);
  const status = git("diff", "--no-renames", "--name-status", "-z", tipSha, sha).split("\0").filter(Boolean);
  const changed = new Set(), addDel = [];
  for (let i = 0; i < status.length; i += 2) {
    changed.add(status[i + 1]);
    if (status[i] !== "M") addDel.push(status[i + 1]);
  }
  const manifests = [...changed].filter((p) => /(^|\/)package\.json$/.test(p));
  const manifestsResolution = manifests.filter((p) => resolutionFieldsChanged(sha, p));
  const tsconfigs = [...changed].filter((p) => /(^|\/)tsconfig[^/]*\.json$/.test(p));
  const xKeys = walkAtX ? JSON.parse(readFileSync(walkAtX, "utf8")).keys : null;
  const variants = { V0_blobs: 0, V1_listings: 0, V2_shadowing: 0, V3_manifestFields: 0, V4_anyManifest: 0, V5_lockfileByEnvSteps: 0 };
  const unsound = Object.fromEntries(Object.keys(variants).map((k) => [k, 0]));
  const reasons = { untracked: 0, blob: 0, pattern: 0, listing: 0, shadowing: 0, manifestField: 0, tsconfig: 0, anyManifest: 0, absentAtX: 0 };
  let keyEqual = 0, compared = 0;
  const files = Object.entries(tip.inputs);
  for (const [id, inputs] of files) {
    const path = id.split("\t")[1];
    const fileInputs = inputs.filter((p) => listed(p) === null && !isPattern(p));
    const listings = inputs.map(listed).filter((d) => d !== null);
    const patterns = inputs.filter(isPattern);
    const dirsOf = new Set(fileInputs.map((p) => posix.dirname(p)).map((d) => (d === "." ? "" : d)));
    const underInputs = (dir) => [...dirsOf].some((d) => d === dir || d.startsWith(dir === "" ? "" : `${dir}/`) || dir === "");
    // The installed lockfile stands for the committed one beside its node_modules (environment-at-commit Q1).
    const installed = fileInputs.filter((p) => /(^|\/)node_modules\/\.pnpm\/lock\.yaml$/.test(p));
    const tracked = fileInputs.filter((p) => tipTree.files.has(p));
    // On disk at the walked tip but not in its git tree: untracked, never judged from git.
    const onDiskOnly = fileInputs.filter(
      (p) => !walkedTree.files.has(p) && p !== ".git" && !installed.includes(p) && existsSync(`${tip.root}/${p}`),
    );
    // Not in the asker's tree: absent there (a resolution candidate, hashed as absent).
    const absentHere = fileInputs.filter(
      (p) => !tipTree.files.has(p) && p !== ".git" && !installed.includes(p) && !onDiskOnly.includes(p),
    );
    const untracked =
      onDiskOnly.length > 0 || listings.some((d) => !walkedTree.names.has(d) && existsSync(`${tip.root}/${d}`));
    const lockChanged = installed.some((p) => changed.has(p.replace(/node_modules\/\.pnpm\/lock\.yaml$/, "pnpm-lock.yaml")));
    const blobNoLock = tracked.some((p) => changed.has(p)) || absentHere.some((p) => xTree.files.has(p) || xTree.names.has(p));
    const blob = blobNoLock || lockChanged;
    const pattern = patterns.some((g) => [...changed].some((c) => matchesGlob(c, g)));
    const listing = listings.some((d) => !sameNames(tipTree.names.get(d), xTree.names.get(d)));
    const modules = fileInputs.filter((p) => MODULE.test(p));
    const moduleKeys = new Set(modules.map((p) => `${posix.dirname(p)}\0${stem(p)}`));
    const shadowing = addDel.some((p) => moduleKeys.has(`${posix.dirname(p)}\0${stem(p)}`) && !fileInputs.includes(p));
    const onPath = (m) => underInputs(posix.dirname(m) === "." ? "" : posix.dirname(m));
    const manifestField = manifestsResolution.some(onPath);
    const tsconfig = tsconfigs.some(onPath);
    const anyManifest = manifests.some(onPath) || tsconfig;
    const absentAtX = !xTree.files.has(path);
    const flags = { untracked, blob, pattern, listing, shadowing, manifestField, tsconfig, anyManifest, absentAtX };
    for (const [k, v] of Object.entries(flags)) if (v) reasons[k]++;
    const v0 = !untracked && !blob && !pattern && !absentAtX;
    const v1 = v0 && !listing;
    const v2 = v1 && !shadowing;
    const v3 = v2 && !manifestField && !tsconfig;
    const v4 = v2 && !anyManifest;
    // V5: V3, except that a changed lockfile alone is left to the parked environment steps (D2.2).
    const v5 = !untracked && !blobNoLock && !pattern && !absentAtX && !listing && !shadowing && !manifestField && !tsconfig;
    const verdicts = { V0_blobs: v0, V1_listings: v1, V2_shadowing: v2, V3_manifestFields: v3, V4_anyManifest: v4, V5_lockfileByEnvSteps: v5 };
    let equal = null;
    if (xKeys !== null && id in xKeys) {
      compared++;
      equal = xKeys[id] === tip.keys[id];
      if (equal) keyEqual++;
    }
    for (const [k, v] of Object.entries(verdicts)) {
      if (!v) continue;
      variants[k]++;
      if (equal === false) unsound[k]++;
    }
  }
  const n = files.length;
  const pct = (x) => Math.round((1000 * x) / n) / 10;
  console.log(
    JSON.stringify({
      label,
      sha,
      tip: tipSha.slice(0, 9),
      files: n,
      changedPaths: changed.size,
      addedOrDeleted: addDel.length,
      changedManifests: manifests.length,
      manifestsWithResolutionChange: manifestsResolution.length,
      changedTsconfigs: tsconfigs.length,
      fastPathPct: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, pct(v)])),
      fastPathFiles: variants,
      walkedKeyEqual: xKeys === null ? null : { equal: keyEqual, compared, pct: Math.round((1000 * keyEqual) / compared) / 10 },
      acceptedButKeyDiffers: xKeys === null ? null : unsound,
      reasonCounts: reasons,
    }),
  );
}
