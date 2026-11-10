// Throwaway probe for research/ci-evidence.md, Q1, Q2 and Q4. Not product code.
//
// Loaded through NODE_OPTIONS (--require) beside `squeal ci record`'s own hook,
// in the project's own Vitest CLI process. It finds the Vitest class as
// `vitest-ci.cjs` does (row 018-26) and wraps `start`. Before the original
// `start` runs, which is where Vitest calls `initCoverageProvider()` in 4.1.10
// and 5.0.3, it sets `configOverride.coverage` to Squeal's provider. That is
// what Q1 asks: can the provider be added before the workers start.
//
// At run end, a reporter takes the provider's batches and maps each test
// file's payload to a coverage record in this process (the mapper bundled to
// CommonJS, `map-entry.ts`), with a stamp of the bytes Vite read, as
// `SourceStamps` takes it. It writes one JSON line per test file: payload
// bytes, record bytes, source count, map time.
//
// Settings, env PROBE_CI: JSON { provider, out, mode, mapper }.
//   mode "provider": add the provider, map records.
//   mode "nomap":    add the provider, map nothing (worker cost only).
//   mode "yield":    add the provider only when the run has no coverage of its own.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { isMainThread } = require("node:worker_threads");

let settings = null;
try {
  settings = JSON.parse(process.env.PROBE_CI ?? "");
} catch {}

function vitestPackage(main) {
  if (typeof main !== "string" || !path.basename(main).startsWith("vitest")) return null;
  const file = fs.realpathSync(main);
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      return m.name === "vitest" ? dir : null;
    } catch {}
  }
  return null;
}

function vitestClass(load) {
  const file = load.resolve("vitest/node");
  const node = load(file);
  const modules = [node];
  const source = fs.readFileSync(file, "utf8");
  for (const [, s] of source.matchAll(/\bfrom\s*["'](\.\.?\/[^"']+)["']/g)) {
    try {
      modules.push(load(path.resolve(path.dirname(file), s)));
    } catch {}
  }
  for (const m of modules) {
    for (const v of Object.values(m)) {
      if (typeof v === "function" && v.version === node.version && typeof v.prototype?.start === "function") return v;
    }
  }
  return null;
}

function log(event) {
  fs.appendFileSync(path.join(settings.out, `events-${process.pid}.jsonl`), `${JSON.stringify(event)}\n`);
}

function environmentsOf(vitest) {
  const out = new Set();
  for (const project of vitest.projects) {
    for (const env of Object.values(project.vite.environments ?? {})) out.add(env);
  }
  return out;
}

/** As `SourceStamps.attach`: hash the bytes each container's `load` reads, by module id. */
function attachStamps(vitest, stamps, root) {
  for (const env of environmentsOf(vitest)) {
    const container = env.pluginContainer;
    if (stamps.has(container)) continue;
    const reads = new Map();
    stamps.set(container, reads);
    const load = container.load.bind(container);
    container.load = async (id) => {
      if (id.startsWith(`${root}/`) && !id.includes("/node_modules/") && !id.includes("?")) {
        try {
          reads.set(id, crypto.createHash("sha1").update(fs.readFileSync(id)).digest("hex"));
        } catch {}
      }
      return load(id);
    };
  }
}

function executedSources(env, stamps, root) {
  const sources = new Map();
  const reads = stamps.get(env.pluginContainer) ?? new Map();
  for (const [id, module] of env.moduleGraph.idToModuleMap) {
    if (!id.startsWith(`${root}/`) || id.includes("/node_modules/") || id.includes("?")) continue;
    const t = module.transformResult ?? module.invalidationState;
    if (!t || typeof t.code !== "string") continue;
    sources.set(id, { path: path.relative(root, id), code: t.code, map: t.map ?? null, sha1: reads.get(id) });
  }
  return sources;
}

function install(vitestDir) {
  const root = fs.realpathSync(process.cwd());
  const load = createRequire(path.join(vitestDir, "package.json"));
  const Vitest = vitestClass(load);
  if (Vitest === null) return log({ kind: "error", text: "no Vitest class" });
  const mapper = settings.mode === "nomap" ? null : require(settings.mapper);
  const original = Vitest.prototype.start;
  const stamps = new WeakMap();
  Vitest.prototype.start = async function start(...args) {
    const own = this.config.coverage ?? {};
    log({
      kind: "start",
      vitest: this.version,
      ownCoverage: { enabled: own.enabled, provider: own.provider },
      providerBefore: this._coverageProvider != null,
      workersStarted: Boolean(this.pool),
    });
    const yieldToOwn = settings.mode === "yield" && own.enabled === true;
    if (!yieldToOwn) {
      const dir = path.join(settings.out, `reports-${process.pid}`);
      this.configOverride.coverage = {
        enabled: true,
        provider: "custom",
        customProviderModule: settings.provider,
        reporter: [],
        reportsDirectory: dir,
        coverageFilesDirectory: path.join(dir, ".tmp"),
        clean: false,
      };
      const allowed = new Set([settings.provider, fs.realpathSync.native(settings.provider)]);
      for (const server of new Set([this.vite, ...this.projects.map((p) => p.vite)])) {
        const list = server.config.server.fs.allow;
        for (const f of allowed) if (!list.includes(f)) list.push(f);
      }
      attachStamps(this, stamps, root);
      this.reporters.push(reporter(this, mapper, stamps, root));
    } else {
      log({ kind: "yield", text: "the run has coverage of its own: no records" });
    }
    return original.apply(this, args);
  };
}

function reporter(vitest, mapper, stamps, root) {
  return {
    onTestRunEnd() {
      const t0 = performance.now();
      const c0 = process.cpuUsage();
      const provider = vitest.coverageProvider;
      const batches = provider?.takeBatches?.() ?? [];
      log({ kind: "provider", name: provider?.name ?? null, batches: batches.length });
      const executed = new Map();
      let total = 0;
      for (const batch of batches) {
        const [file, ...more] = batch.testFiles;
        const project = vitest.projects.find((p) => p.name === batch.projectName);
        const env = project?.vite.environments[batch.environment];
        const payloadBytes = fs.statSync(batch.coverage).size;
        if (mapper === null || more.length > 0 || !env) {
          log({ kind: "file", file, payloadBytes, more: more.length, mapped: false });
          continue;
        }
        let sources = executed.get(env);
        const s0 = performance.now();
        if (!sources) {
          sources = executedSources(env, stamps, root);
          executed.set(env, sources);
        }
        const testFile = { project: batch.projectName, path: path.relative(root, path.resolve(project.config.root, file)) };
        const m0 = performance.now();
        const payload = JSON.parse(fs.readFileSync(batch.coverage, "utf8"));
        const record = mapper.buildRecord({ testFile, payload: batch.coverage, sources }, payload.result, "sha1", new Map(), (p) => p === settings.provider);
        const encoded = mapper.encodeRecord(record);
        const shared = mapper.shareRecord(record, mapper.COVERAGE_PROVIDER_VERSION);
        const m1 = performance.now();
        total += m1 - s0;
        if (settings.dump) {
          const to = path.join(settings.out, "records", `${testFile.path.replaceAll("/", "__")}.json`);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.writeFileSync(to, JSON.stringify(record));
        }
        const covered = record.sources.reduce((n, s) => n + Buffer.from(s.covered, "base64").reduce((a, b) => a + popcount(b), 0), 0);
        log({
          kind: "file",
          file: testFile.path,
          payloadBytes,
          recordBytes: encoded.length,
          sharedParts: shared.parts.map((p) => [p.hash.slice(0, 12), p.bytes.length]),
          sources: record.sources.length,
          unread: record.unread.length,
          coveredLines: covered,
          sourcesMs: +(m0 - s0).toFixed(2),
          mapMs: +(m1 - m0).toFixed(2),
          mapped: true,
        });
      }
      const c = process.cpuUsage(c0);
      log({ kind: "end", wallMs: +(performance.now() - t0).toFixed(1), cpuMs: +((c.user + c.system) / 1000).toFixed(1), mapMs: +total.toFixed(1) });
    },
  };
}

function popcount(b) {
  let n = 0;
  for (; b; b >>= 1) n += b & 1;
  return n;
}

if (settings !== null && isMainThread && !globalThis.__probeCi) {
  globalThis.__probeCi = true;
  try {
    const root = vitestPackage(process.argv[1]);
    if (root !== null) install(root);
  } catch (error) {
    log({ kind: "error", text: String(error?.stack ?? error) });
  }
}
