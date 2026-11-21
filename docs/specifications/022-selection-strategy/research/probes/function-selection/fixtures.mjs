// Throwaway: rule A on fixtures with real Vitest 5.0.3, Squeal's coverage
// provider (`provider.mjs`), its record mapper (`sourceEntry`) and its input
// recorder (`recorder.cjs`). Each case runs in its own directory under
// $TMPDIR, one worker, isolated. After every edit the test file runs anyway
// (the oracle); rule A's decision is made first, from the record of the last
// run rule A would have made. A skip keeps that record and the last result.
//   timeout 900 node --import tsx fixtures.mjs <out.json> [case-prefix...]
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createVitest } from "vitest/node";
import { sourceEntry } from "../../../../../../src/core/code/coverage/record.ts";
import { judge, isScript } from "./structure.mjs";
import { cases } from "./fixtures-cases.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const blob = (s) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest("hex");
const [outPath, ...only] = process.argv.slice(2);
const base = process.env.TMPDIR ?? "/tmp";
const results = [];
for (const fx of cases.filter((c) => !only.length || only.some((o) => c.name.startsWith(o)))) {
  if (loadavg()[0] > 24) throw new Error(`load ${loadavg()[0]} above 24 (README rule); stop`);
  const dir = mkdtempSync(join(base, "fsel-"));
  const files = { "package.json": '{"type":"module"}\n', ...fx.files };
  for (const [p, c] of Object.entries(files)) writeFileSync(join(dir, p), c);
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "dir");
  const observedDir = join(dir, ".observed"); mkdirSync(observedDir);
  let current;
  const reporter = {
    onTestCaseResult(t) { current.tests.push({ name: t.fullName, state: t.result().state, errors: (t.result().errors ?? []).map((e) => e.message.slice(0, 200)) }); },
    onTestModuleEnd(m) { current.modules.push({ state: m.state(), errors: m.errors().map((e) => e.message.slice(0, 200)) }); },
    onTestRunEnd(_m, errors) { current.errors.push(...errors.map((e) => String(e.message).slice(0, 200))); },
  };
  const v = await createVitest("test", {
    root: dir, config: false, watch: false, pool: "forks", maxWorkers: 1, isolate: true, fileParallelism: false,
    reporters: [reporter], update: "new", include: ["*.test.ts"], testTimeout: 10000,
    env: { NODE_OPTIONS: `--require ${join(repo, "src/runners/observe/recorder.cjs")}`, SQUEAL_OBSERVE: JSON.stringify({ out: observedDir, root: dir, skip: [] }) },
    coverage: { enabled: true, provider: "custom", customProviderModule: join(repo, "src/core/code/coverage/provider.mjs"), reportsDirectory: join(dir, ".coverage"), reporter: [] },
  });
  const steps = [];
  try {
    await v.standalone();
    const specs = await v.globTestSpecifications();
    const run = async () => {
      for (const f of readdirSync(observedDir)) rmSync(join(observedDir, f));
      current = { tests: [], modules: [], errors: [] };
      await v.runTestSpecifications(specs);
      const record = new Map();
      for (const batch of v.coverageProvider?.takeBatches?.() ?? []) {
        const payload = JSON.parse(readFileSync(batch.coverage, "utf8"));
        const env = v.projects.find((p) => p.name === batch.projectName).vite.environments[batch.environment];
        for (const script of payload.result) {
          if (!script.url.startsWith("file://")) continue;
          const abs = fileURLToPath(script.url);
          const rel = relative(dir, abs);
          if (rel.startsWith("..") || rel.includes("node_modules") || rel.endsWith(".test.ts")) continue;
          const mod = env.moduleGraph.getModuleById(abs);
          const tr = mod?.transformResult;
          if (!tr?.code) continue;
          record.set(rel, sourceEntry(script, { path: rel, code: tr.code, map: tr.map, sha1: undefined }, blob(readFileSync(abs, "utf8"))));
        }
        rmSync(batch.coverage, { force: true });
      }
      const rows = readdirSync(observedDir).flatMap((f) => readFileSync(join(observedDir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => ({ file: f, ...JSON.parse(l) })));
      const own = rows.filter((r) => r.t && relative(dir, r.t) === "a.test.ts");
      const reads = new Set(own.flatMap((r) => (r.f ?? []).map((p) => relative(dir, p))));
      const direct = new Set(own.flatMap((r) => (r.d ?? []).map((p) => relative(dir, p))));
      const processes = new Set(own.map((r) => r.file)).size;
      const pass = current.errors.length === 0 && current.modules.every((m) => m.state === "passed") && current.tests.length > 0 && current.tests.every((t) => t.state === "passed");
      const outcome = JSON.stringify({ pass, tests: current.tests.map((t) => [t.name, t.state]) });
      return { pass, outcome, detail: structuredClone(current), record, reads, direct, processes };
    };
    let last = await run(); // the record and result rule A carries
    if (!last.pass) throw new Error(`baseline failed: ${JSON.stringify(last.detail)}`);
    let contents = { ...fx.files };
    let recorded = { ...fx.files }; // the bytes of the last run, the record's
    for (const edit of fx.edits) {
      const next = { ...contents, ...edit };
      // FSEL_STEPWISE=1: judge each edit against the previous edit's bytes instead (Q4's other reading)
      if (process.env.FSEL_STEPWISE) recorded = { ...contents, ...Object.fromEntries([...last.record.keys()].filter((p) => !(p in contents)).map((p) => [p, ""])) };
      const changed = Object.keys(next).filter((p) => next[p] !== recorded[p]);
      // rule A, conditions 1 to 5 in order
      let decision = "skip", why = [];
      for (const p of changed) {
        const src = last.record.get(p);
        if (p === "a.test.ts") why.push("c2:testFile");
        else if (!src) why.push(isScript(p) ? "c2:scriptNotLoaded" : "c2:nonScript");
        else if (src.blob !== blob(recorded[p])) why.push("c1:recordNotAtOldBytes");
        else {
          const r = judge(p, recorded[p], next[p], src);
          for (const k of r.verdicts) why.push(k === "entered" || k === "unmapped" ? `c2:${k}` : k === "skeleton" ? "c3:skeleton" : k === "parse" ? "c4:parse" : k);
          why.push(...r.changed.map((c) => `fn ${c.name} entered=${c.entered}`).map((s) => `(${s})`));
        }
      }
      const blocking = why.filter((w) => !w.startsWith("("));
      if (blocking.length === 0) {
        if (last.direct.size > 0) blocking.push("c5:childProcess");
        else if (changed.some((p) => last.reads.has(p))) blocking.push("c5:readAsData");
      }
      if (blocking.length) decision = "run";
      for (const [p, c] of Object.entries(edit)) { writeFileSync(join(dir, p), c); v.invalidateFile(join(dir, p)); }
      contents = { ...contents, ...edit };
      const now = await run();
      const changedResult = now.outcome !== last.outcome;
      steps.push({ changed, decision, reasons: [...new Set(blocking)], notes: why.filter((w) => w.startsWith("(")), resultBefore: last.pass ? "pass" : "fail", resultAfter: now.pass ? "pass" : "fail", resultChanged: changedResult, miss: decision === "skip" && changedResult, afterErrors: now.detail.tests.flatMap((t) => t.errors).concat(now.detail.modules.flatMap((m) => m.errors), now.detail.errors).slice(0, 2), childSeen: last.direct.size, processRows: last.processes });
      if (process.env.FSEL_DEBUG) console.error(JSON.stringify({ record: Object.fromEntries([...last.record].map(([k, v]) => [k, v.functions])) }));
      if (decision === "run") { last = now; recorded = { ...contents }; } // a skip makes no record and keeps the old result
    }
    results.push({ name: fx.name, steps });
    console.error(fx.name, steps.map((s) => `${s.decision}${s.miss ? " MISS" : ""} [${s.reasons.join(",")}] ${s.resultBefore}->${s.resultAfter}`).join(" | "));
  } catch (e) {
    results.push({ name: fx.name, error: String(e.stack ?? e).slice(0, 500) });
    console.error(fx.name, "ERROR", String(e).slice(0, 300));
  } finally {
    await v.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
writeFileSync(outPath, JSON.stringify({ node: process.version, vitest: "5.0.3", load: loadavg(), results }, null, 1));
process.exit(0);
