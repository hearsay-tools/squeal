// Throwaway probe for research 011-53, question 3. Runs only inside the /tmp scratch that
// setup.sh makes, with its HOME, XDG_* and TMPDIR. It starts no daemon.
//   node --expose-gc close-reopen.mjs <root> <edited-file> <reps>
// One Vitest instance with the adapter's options (`adapter.ts` #start: root, watch false,
// update "none", includeTaskLocation, fsModuleCache false), at 4 workers. It mimics the work a
// daemon does:
//   start    createVitest + standalone, list the test files (globTestSpecifications)
//   walk     the keying walk: every listed file's import closure through the ssr transform
//            (Squeal's importClosure, `graph.ts`, simplified to moduleGraph edges)
//   edit     append a comment to <edited-file>, invalidate it, the related walk (Vitest's
//            getRelevantTestSpecifications with config.related, as `related.ts`), the closure
//            of the related files (re-keying), and a run of the first 4 of them (one tier)
// Then it measures warm edits (same instance) and cold edits (close, GC, new instance, then
// the same edit work), <reps> times each, with private memory and the heap after a full GC
// at every step. The edited file is restored at the end. One JSON line per step on stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const [root, editedRel, repsArg] = process.argv.slice(2);
const reps = Number(repsArg ?? 3);
const edited = join(root, editedRel);
const original = readFileSync(edited, "utf8");
const mib = (n) => Math.round((n / 2 ** 20) * 10) / 10;
const priv = () => {
  const s = readFileSync("/proc/self/status", "utf8");
  const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(s)?.[1] ?? 0);
  return { privMiB: mib((kb("RssAnon") + kb("RssShmem")) * 1024), swapMiB: mib(kb("VmSwap") * 1024) };
};
const smaps = () => {
  const out = { heap256: 0, mimalloc: 0, glibc: 0, anonOther: 0 };
  let cur = null;
  for (const line of readFileSync("/proc/self/smaps", "utf8").split("\n")) {
    const m = /^([0-9a-f]+)-([0-9a-f]+) \S+ \S+ \S+ (\d+)\s*(.*)$/.exec(line);
    if (m) {
      const size = parseInt(m[2], 16) - parseInt(m[1], 16);
      const name = m[4].trim();
      if (m[3] !== "0" && name.startsWith("/")) cur = null;
      else if (name === "[anon:mimalloc]") cur = "mimalloc";
      else if (name === "[heap]") cur = "glibc";
      else if (name === "" && size === 256 * 1024) cur = "heap256";
      else cur = "anonOther";
    } else if (cur && line.startsWith("Rss:")) out[cur] += Number(line.split(/\s+/)[1]);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v / 1024)]));
};
const load1 = () => readFileSync("/proc/loadavg", "utf8").split(" ")[0];
const log = (step, extra = {}) => {
  const before = process.memoryUsage();
  const t0 = performance.now();
  globalThis.gc({ type: "major", execution: "sync" });
  const gcMs = Math.round(performance.now() - t0);
  const m = process.memoryUsage();
  console.log(
    JSON.stringify({
      step,
      load1: load1(),
      heapUsedBeforeGcMiB: mib(before.heapUsed),
      heapTotalBeforeGcMiB: mib(before.heapTotal),
      gcMs,
      heapUsedMiB: mib(m.heapUsed),
      heapTotalMiB: mib(m.heapTotal),
      externalMiB: mib(m.external),
      ...priv(),
      ...smaps(),
      ...extra,
    }),
  );
};

const { createVitest } = await import(
  pathToFileURL(join(root, "node_modules/vitest/dist/node.js")).href
);
process.chdir(root);
log("bare");

async function start() {
  const t = { t0: performance.now() };
  const vitest = await createVitest("test", {
    root,
    watch: false,
    reporters: [{}],
    update: "none",
    includeTaskLocation: true,
    fsModuleCache: false,
    maxWorkers: 4,
  });
  t.created = performance.now();
  await vitest.standalone();
  t.standalone = performance.now();
  const specs = (await vitest.globTestSpecifications()).filter(
    (s) => s.pool !== "typescript" && !s.moduleId.includes("/packages/web/e2e/"),
  );
  t.listed = performance.now();
  return {
    vitest,
    specs,
    ms: {
      create: Math.round(t.created - t.t0),
      standalone: Math.round(t.standalone - t.created),
      list: Math.round(t.listed - t.standalone),
    },
  };
}

// Squeal's importClosure, simplified: follow the ssr module graph's imported modules.
async function closure(project, entry) {
  const env = project.vite.environments.ssr;
  const seen = new Set();
  const visit = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.includes("node_modules")) return;
    try {
      if (!env.moduleGraph.getModuleById(file)?.transformResult) await env.transformRequest(file);
    } catch {
      return;
    }
    const mod = env.moduleGraph.getModuleById(file);
    await Promise.all([...(mod?.importedModules ?? [])].map((m) => m.file).filter(Boolean).map(visit));
  };
  await visit(entry);
  return seen.size;
}

async function walkAll(specs) {
  const t0 = performance.now();
  let files = 0;
  for (const s of specs) files += await closure(s.project, s.moduleId);
  return { walkMs: Math.round(performance.now() - t0), walkedFiles: files };
}

let editNo = 0;
async function edit(vitest, specs) {
  editNo += 1;
  const t0 = performance.now();
  writeFileSync(edited, `${original}\n// probe 011-53 edit ${editNo}\n`);
  vitest.invalidateFile(edited);
  vitest.config.related = [edited];
  let related;
  try {
    related = await vitest.getRelevantTestSpecifications();
  } finally {
    delete vitest.config.related;
  }
  const known = new Set(specs.map((s) => s.moduleId));
  related = related.filter((s) => known.has(s.moduleId)).sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1));
  const t1 = performance.now();
  for (const s of related) await closure(s.project, s.moduleId);
  const t2 = performance.now();
  const tier = related.slice(0, 4);
  const result = await vitest.runTestSpecifications(tier);
  const t3 = performance.now();
  const states = vitest.state.getFiles().filter((f) => tier.some((s) => s.moduleId === f.filepath)).map((f) => f.result?.state);
  return {
    related: related.length,
    tier: tier.map((s) => relative(root, s.moduleId)),
    states,
    unhandled: result.unhandledErrors?.length ?? 0,
    ms: { related: Math.round(t1 - t0), rekey: Math.round(t2 - t1), run: Math.round(t3 - t2), total: Math.round(t3 - t0) },
  };
}

try {
  let { vitest, specs, ms } = await start();
  log("started", { specs: specs.length, ms });
  log("walked", await walkAll(specs));
  log("first-edit", await edit(vitest, specs));
  for (let i = 1; i <= reps; i++) log(`warm-edit-${i}`, await edit(vitest, specs));
  await vitest.close();
  log("closed");
  await new Promise((r) => setTimeout(r, 5000));
  log("closed+5s");
  for (let i = 1; i <= reps; i++) {
    const t0 = performance.now();
    ({ vitest, specs, ms } = await start());
    const e = await edit(vitest, specs);
    log(`cold-edit-${i}`, { startMs: ms, ...e, coldTotalMs: Math.round(performance.now() - t0) });
    await vitest.close();
    log(`closed-${i}`);
  }
} finally {
  writeFileSync(edited, original);
}
process.exit(0);
