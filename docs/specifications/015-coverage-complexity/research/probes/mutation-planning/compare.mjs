// Throwaway probe for research/mutation-planning.md (row 015-125), questions 1 and 3.
// For each cezar pull request whose mutation job left a Stryker report (the newest such run per branch), and
// for each package it mutated or skipped for its test count, count test files four ways:
//   related   - the job's own Vitest `related` count at the PR head (mutants.json relatedTests)
//   dry run   - the test files of Stryker's report (what its dry run ran)
//   covering  - test files of Stryker's per-test coverage (union of the mutants' coveredBy)
//   squeal    - test files of the package's project whose newest Squeal coverage record (index.json, from
//               records.mjs) names a mutated file: "called" (a function of the file ran) and "loaded only"
// Where the record's blob equals the file at the PR head, it also checks each mutant line by line:
// the test files whose record covers the mutant's line, against Stryker's coveredBy and killedBy files.
// usage: node compare.mjs <art dir> <runs.txt> <index.json> <cezar repo> <out.json>
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [artDir, runsTxt, indexJson, repo, out] = process.argv.slice(2);
const PROJECT = { cezar: "server", web: "web", contract: "contract", "api-client": "api-client" };
const NOT_PRODUCT = /(^|\/)(__tests__|__fixtures__|fixtures|test|tests)\/|\.(test|testkit|spec|e2e)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;
const runs = new Map();
for (const line of readFileSync(runsTxt, "utf8").split("\n").slice(1)) {
  const [id, at, sha, branch] = line.split(" ");
  if (id) runs.set(id, { at, sha, branch });
}
const { index } = JSON.parse(readFileSync(indexJson, "utf8"));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 26 });
const blobAt = (head, path) => { try { return git("rev-parse", `${head}:${path}`).trim(); } catch { return null; } };
const bit = (b64, line) => { const b = Buffer.from(b64, "base64"); const i = line - 1; return (b[i >> 3] >> (i & 7)) & 1; };

// changed product files of a package at a PR head, as the job's scope step finds them (merge base with main then)
function changedFiles(head, at, pkg) {
  const main = git("rev-list", "-1", `--before=${at}`, "origin/main").trim();
  const base = git("merge-base", main, head).trim();
  return git("-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", "--diff-filter=AM", base, head, "--", `packages/${pkg}/src`)
    .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !NOT_PRODUCT.test(f));
}

// newest run per branch that has a Stryker report or a skip for the test count
const chosen = new Map();
for (const id of readdirSync(artDir)) {
  const r = runs.get(id); if (!r) continue;
  const a = JSON.parse(readFileSync(`${artDir}/${id}/mutants.json`, "utf8"));
  const useful = a.packages.some((p) => p.state === "completed" || /test files import/.test(p.reason));
  if (!useful) continue;
  const prev = chosen.get(r.branch);
  if (!prev || prev.at < r.at) chosen.set(r.branch, { id, ...r, a });
}

const rows = [];
for (const c of chosen.values()) {
  for (const p of c.a.packages) {
    const capped = /test files import/.test(p.reason);
    if (p.state !== "completed" && !capped) continue;
    const reportPath = `${artDir}/${c.id}/stryker-${p.name}.json`;
    const report = p.state === "completed" && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
    const files = report ? Object.keys(report.files) : changedFiles(c.a.head, c.at, p.name);
    const project = PROJECT[p.name];
    const called = new Set(), loadedOnly = new Set(), loaded = new Set();
    let blobMatch = 0;
    for (const f of files) {
      const head = blobAt(c.a.head, f);
      const entries = (index[f] ?? []).filter((e) => e.project === project);
      if (entries.some((e) => e.blob === head)) blobMatch++;
      for (const e of entries) { loaded.add(e.test); if (e.called) called.add(e.test); }
    }
    for (const t of loaded) if (!called.has(t)) loadedOnly.add(t);
    const row = { branch: c.branch, run: c.id, head: c.a.head.slice(0, 9), pkg: p.name, state: p.state, files: files.length, fileList: files, blobMatch,
      related: p.relatedTests, squealLoaded: loaded.size, squealCalled: called.size, squealLoadedOnly: loadedOnly.size, counts: p.counts };
    if (report) {
      const fileOf = new Map();
      for (const [tf, { tests }] of Object.entries(report.testFiles ?? {})) for (const t of tests) fileOf.set(t.id, tf);
      row.dryRun = Object.keys(report.testFiles ?? {}).length;
      const covering = new Set(), killing = new Set();
      // per-mutant checks on files whose record blob is the PR head's
      const m = { mutants: 0, checked: 0, killedChecked: 0, killerInCalled: 0, killerInLine: 0, noCovSquealNone: 0, noCovSquealLine: 0, noCov: 0,
        coveredByNotInCalled: 0, coveredByNotInLine: 0, coveredPairs: 0, lineSet: 0, coveredSet: 0, staticKilled: 0 };
      for (const [f, { mutants }] of Object.entries(report.files)) {
        const head = blobAt(c.a.head, f);
        const entries = (index[f] ?? []).filter((e) => e.project === project && e.blob === head);
        const calledF = new Set(entries.filter((e) => e.called).map((e) => e.test));
        for (const mu of mutants) {
          m.mutants++;
          const cov = new Set((mu.coveredBy ?? []).map((id) => fileOf.get(id)).filter(Boolean));
          const kil = new Set((mu.killedBy ?? []).map((id) => fileOf.get(id)).filter(Boolean));
          for (const t of cov) covering.add(t);
          for (const t of kil) killing.add(t);
          if (mu.status === "Ignored" || !entries.length) continue;
          m.checked++;
          const line = new Set(entries.filter((e) => e.covered && bit(e.covered, mu.location.start.line)).map((e) => e.test));
          m.lineSet += line.size; m.coveredSet += cov.size;
          for (const t of cov) { m.coveredPairs++; if (!calledF.has(t)) m.coveredByNotInCalled++; if (!line.has(t)) m.coveredByNotInLine++; }
          if (mu.status === "Killed" && kil.size) {
            m.killedChecked++;
            if ([...kil].some((t) => calledF.has(t))) m.killerInCalled++;
            if ([...kil].some((t) => line.has(t))) m.killerInLine++;
            if (mu.static) m.staticKilled++;
          }
          if (mu.status === "NoCoverage") { m.noCov++; if (line.size === 0) m.noCovSquealLine++; if (calledF.size === 0) m.noCovSquealNone++; }
        }
      }
      row.covering = covering.size; row.killing = killing.size; row.mutantCheck = m;
    }
    rows.push(row);
  }
}
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`${chosen.size} branches, ${rows.length} package rows`);
