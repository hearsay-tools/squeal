// Throwaway: prints the Markdown tables for results.md from closure.mjs's JSON.
// Usage: node tables.mjs <result.json>
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const P = ["node-unit", "workers-unit"];
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const out = [];
const row = (...c) => out.push("| " + c.join(" | ") + " |");

out.push(`map commit ${r.commit} (tree ${r.tree}); verbatimModuleSyntax=${r.verbatim}\n`);
out.push("### Per test file: set sizes (repo modules)\n");
row("project", "mapped tests", "measure", "median", "p90", "max", "mean");
row("---", "---:", "---", "---:", "---:", "---:", "---:");
for (const p of P) {
  const x = r.projects[p];
  for (const [k, name] of [["observed", "observed (CI map)"], ["staticOnly", "static closure"], ["staticDynamic", "static+dynamic closure"], ["staticDynamicSetup", "static+dynamic+setup"], ["extraOverObserved", "closure minus observed"], ["missing", "observed not in closure"]])
    row(p, x.mappedTests, name, x[k].median, x[k].p90, x[k].max, x[k].mean);
  if (x.mainEntry) row(p, x.mappedTests, "static+dynamic+setup+wrangler main", x.mainEntry.withMain.median, x.mainEntry.withMain.p90, x.mainEntry.withMain.max, x.mainEntry.withMain.mean);
}
out.push("");
for (const p of P) {
  const x = r.projects[p];
  out.push(`- ${p}: setup closure ${x.setupClosure} files; tests with closure within 10% of observed: ${x.testsClosureWithin10pct}/${x.mappedTests}; closure/observed ratio median ${x.ratioFullOverObserved.median}, p90 ${x.ratioFullOverObserved.p90}; tests with an observed path outside the closure: ${x.testsWithMiss} (${x.missing.total} pairs, ${x.missPathCount} distinct paths); observed pairs reached only through dynamic edges: ${x.observedReachedOnlyByDynamic.total} in ${x.observedReachedOnlyByDynamic.testsWithAny} tests; unmapped on-disk tests: ${x.unmapped.length} (${x.unmapped.join(", ")})`);
  out.push(`  - resolution over files the closures reach: ${x.reachableResolution.unresolved} unresolved of ${x.reachableResolution.specs} specifiers (${(100 * x.reachableResolution.rate).toFixed(3)}%) in ${x.reachableResolution.files_with_unresolved.join(", ")}`);
  out.push(`  - top observed paths outside the closure: ${x.topMissPaths.slice(0, 6).map(([a, b]) => `${a} (${b})`).join("; ")}`);
  if (x.mainEntry) out.push(`  - with the wrangler main closure (${x.mainEntry.closure} files) added to every test: ${x.mainEntry.missing} pairs still outside, in ${x.mainEntry.testsWithMiss} tests: ${x.mainEntry.topMissPaths.map(([a, b]) => `${a} (${b})`).join("; ")}`);
}

out.push("\n### Per source file: test files selecting it\n");
row("source", "project", "observed", "static only", "static+dynamic", "+setup", "+wrangler main");
row("---", "---", "---:", "---:", "---:", "---:", "---:");
for (const n of r.named) for (const p of P) row("`" + n.s.replace("packages/worker/src/", "…/") + "`", p, n[p].obs, n[p].static, n[p].sd, n[p].full, n[p].withMain ?? "");
out.push("");
for (const p of P) {
  const x = r.projects[p].perSource;
  out.push(`- ${p}: ${x.sources} sources selected by something; sum over sources of selected tests: observed ${x.sumObserved}, static+dynamic ${x.sumStaticDynamic}, +setup ${x.sumStaticDynamicSetup}; median per JS/TS source observed ${x.medianObserved} vs +setup ${x.medianFull}; sources where observed selects more tests than the closure: ${x.observedGreater}`);
  out.push(`  - biggest closure-minus-observed gaps: ${x.topGap.slice(0, 6).map(([s, o, , f]) => `${s} ${o} vs ${f}`).join("; ")}`);
}

out.push("\n### Replay: first-parent commits before the map commit, one map for all\n");
const reps = r.replay;
row("project", "commits", "measure", "total selected", "median per commit", "commits where observed ⊄ closure");
row("---", "---:", "---", "---:", "---:", "---:");
for (const p of P) {
  const v = (k) => reps.map((c) => c.projects[p][k]);
  row(p, reps.length, "observed (incl. unmapped)", sum(v("obsSel")), med(v("obsSel")), "");
  row(p, reps.length, "observed, mapped only", sum(v("obsSelMappedOnly")), med(v("obsSelMappedOnly")), "");
  row(p, reps.length, "static+dynamic+setup", sum(v("statSel")), med(v("statSel")), reps.filter((c) => c.projects[p].obsNotStat - (c.projects[p].obsSel - c.projects[p].obsSelMappedOnly) > 0).length);
  row(p, reps.length, "static only (no dynamic edges) + static setup", sum(v("sOnlySel")), med(v("sOnlySel")), reps.filter((c) => c.projects[p].obsNotSOnly > 0).length);
  row(p, reps.length, "observed (mapped) but not static-only", sum(v("obsNotSOnly")), med(v("obsNotSOnly")), "");
  row(p, reps.length, "observed but not closure (incl. unmapped)", sum(v("obsNotStat")), med(v("obsNotStat")), "");
  row(p, reps.length, "closure but not observed", sum(v("statNotObs")), med(v("statNotObs")), "");
  if (reps[0].projects[p].mainSel !== undefined) {
    row(p, reps.length, "static+dynamic+setup+wrangler main", sum(v("mainSel")), med(v("mainSel")), reps.filter((c) => c.projects[p].obsNotMain > 0).length);
    row(p, reps.length, "observed but not (closure+main)", sum(v("obsNotMain")), med(v("obsNotMain")), "");
  }
}
out.push("");
const cats = {};
for (const c of reps) for (const [k, fs] of Object.entries(c.escapes)) (cats[k] ??= []).push(`${c.sha} (${fs.slice(0, 3).join(", ")}${fs.length > 3 ? ", …" : ""})`);
out.push("\n### Changed files outside every observed set that could still change results\n");
row("category", "commits", "examples");
row("---", "---:", "---");
for (const [k, v] of Object.entries(cats)) row(k, v.length, v.slice(0, 3).join("; "));
out.push("");
out.push(`- commits touching a path Kody's pre-push treats as a global test input (isGlobalHookTestPath): ${reps.filter((c) => c.globalHook.length).length}/${reps.length}`);
out.push(`- commits whose non-code changes sit in an observed set (md/css/json loaded as modules): ${reps.filter((c) => c.changedLoaded.length).length}: ${reps.filter((c) => c.changedLoaded.length).map((c) => c.sha + " " + c.changedLoaded.join(",")).join("; ")}`);
out.push(`- docs-only commits (Kody's hook skips unit tests) that change an observed path: ${reps.filter((c) => c.docsOnlyButLoaded).length}`);
console.log(out.join("\n"));
