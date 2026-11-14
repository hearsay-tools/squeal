// Throwaway probe (022-02, selection-option). Reads COPIES of a Squeal store
// (store.sqlite and code.sqlite, made with VACUUM INTO through a read-only
// connection) and compares, per test file, the stored closure list
// (`test_files.closure_paths`) with the paths in the newest coverage record
// of that test file (the modules its process loaded, as the provider saw them).
// Usage: tsx loaded-vs-closure.mts <store.sqlite> <code.sqlite> <squeal.config.json> <label>
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createInputMatcher } from "../../../../../../src/core/keys/glob.ts";

const [storePath, codePath, configPath, label] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const store = new DatabaseSync(storePath, { readOnly: true });
const code = new DatabaseSync(codePath, { readOnly: true });

const coverageExcluded = createInputMatcher(config.coverage?.exclude ?? []);
const inputs = config.inputs ?? {};
const declaredFor = (test: string): ((p: string) => boolean) => {
  if (Array.isArray(inputs)) return createInputMatcher(inputs);
  const globs = Object.entries(inputs)
    .filter(([t]) => createInputMatcher([t])(test))
    .flatMap(([, g]) => g as string[]);
  return createInputMatcher(globs);
};
const observedFor = new Map<string, Set<string>>();
for (const row of store.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%' OR key LIKE 'observedModules.%' OR key LIKE 'observedDirect.%'").all() as any[]) {
  const project = row.key.slice(row.key.indexOf(".") + 1);
  let map: Record<string, string[]>;
  try { map = JSON.parse(row.value); } catch { continue; }
  for (const [test, paths] of Object.entries(map)) {
    const id = `${project}\0${test}`;
    const set = observedFor.get(id) ?? new Set();
    for (const p of paths as string[]) set.add(p);
    observedFor.set(id, set);
  }
}

const recorded = new Set((code.prepare("SELECT result_key FROM coverage").all() as any[]).map((r) => r.result_key));
const newestKeys = store.prepare(
  `SELECT r.key, r.recorded_at FROM results r JOIN checks c ON c.id = r.check_id
   WHERE c.kind = 'file' AND c.project = ? AND c.test_path = ? ORDER BY r.recorded_at DESC`);
const recordAt = code.prepare("SELECT record FROM coverage WHERE result_key = ? ORDER BY provider_version DESC LIMIT 1");

function loadedPaths(bytes: Uint8Array): string[] {
  const json = JSON.parse(inflateRawSync(bytes).toString("utf8"));
  if (Array.isArray(json.parts)) return json.unread; // a manifest: `unread` lists every path the record holds
  return [...json.sources.map((s: any) => s.path), ...json.unread];
}

type Kind = "test file itself" | "coverage.exclude" | "declared input" | "observed read" | "snapshot" | "not JS/TS" | "code module, not loaded";
const JS = /\.(?:[cm]?[jt]sx?)$/;
const rows = store.prepare("SELECT project, path, closure_paths FROM test_files").all() as any[];
let files = 0, withRecord = 0, equal = 0, onlyKeep = 0;
const missing: Record<string, number> = {};
const extraKinds: Record<string, number> = {};
const perProject: Record<string, { files: number; withRecord: number; s: number; l: number; onlyKeep: number; narrowedFiles: number }> = {};
const sizes: { s: number; l: number; unloaded: number }[] = [];
for (const row of rows) {
  files++;
  const pp = (perProject[row.project] ??= { files: 0, withRecord: 0, s: 0, l: 0, onlyKeep: 0, narrowedFiles: 0 });
  pp.files++;
  let loaded: string[] | null = null;
  for (const k of newestKeys.all(row.project, row.path) as any[]) {
    if (!recorded.has(k.key)) continue;
    const rec = recordAt.get(k.key) as any;
    if (rec) { loaded = loadedPaths(rec.record); break; }
  }
  if (loaded === null) continue;
  withRecord++; pp.withRecord++;
  const S = new Set<string>(JSON.parse(row.closure_paths));
  const L = new Set<string>(loaded);
  const declared = declaredFor(row.path);
  const observed = observedFor.get(`${row.project}\0${row.path}`) ?? new Set();
  let unloaded = 0, unloadedCode = 0;
  for (const p of S) {
    if (L.has(p)) continue;
    unloaded++;
    let kind: Kind;
    if (p === row.path) kind = "test file itself";
    else if (coverageExcluded(p)) kind = "coverage.exclude";
    else if (declared(p)) kind = "declared input";
    else if (observed.has(p)) kind = "observed read";
    else if (p.endsWith(".snap")) kind = "snapshot";
    else if (!JS.test(p)) kind = "not JS/TS";
    else { kind = "code module, not loaded"; unloadedCode++; }
    missing[kind] = (missing[kind] ?? 0) + 1;
  }
  for (const p of L) if (!S.has(p)) {
    const k = coverageExcluded(p) ? "coverage.exclude" : JS.test(p) ? "code module" : "other";
    extraKinds[k] = (extraKinds[k] ?? 0) + 1;
  }
  if (unloaded === 0 && [...L].every((p) => S.has(p))) equal++;
  // The key would be unchanged if only paths a loaded-set key must keep anyway are missing.
  if (unloadedCode === 0) { onlyKeep++; pp.onlyKeep++; } else pp.narrowedFiles++;
  pp.s += S.size; pp.l += L.size;
  sizes.push({ s: S.size, l: L.size, unloaded: unloadedCode });
}
const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
console.log(JSON.stringify({
  label, testFiles: files, withCoverageRecord: withRecord,
  closureEqualsRecord: equal,
  noUnloadedCodeModule: onlyKeep,
  medianClosurePaths: med(sizes.map((x) => x.s)), medianRecordPaths: med(sizes.map((x) => x.l)),
  medianUnloadedCodeModules: med(sizes.map((x) => x.unloaded)),
  closurePathsNotInRecord: missing, recordPathsNotInClosure: extraKinds, perProject,
}, null, 2));
