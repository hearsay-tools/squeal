// Throwaway probe (015 R3). Maps the raw V8 coverage that child processes
// wrote (one directory per test file, from child-env.setup.ts) to src/ with
// v8-to-istanbul, as c8 does: tsx-loaded src/*.ts through Node's
// source-map-cache; committed plugin bundles (and same-length copies) through
// maps rebuilt by map-bundles.mts. Writes <out>/<testdir>.json (istanbul
// coverage of src/ per test file) and <out>/_summary.json.
// Usage: node convert-children.cjs <repo> <child-raw> <maps> <out>
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const repo = path.resolve(process.argv[2]);
const req = require("node:module").createRequire(path.join(repo, "package.json"));
const v8toIstanbul = req("v8-to-istanbul");
const libCoverage = req("istanbul-lib-coverage");
const { mergeProcessCovs } = req("@bcoe/v8-coverage");
const [rawRoot, mapsRoot, outRoot] = process.argv.slice(3).map((p) => path.resolve(p));
fs.mkdirSync(outRoot, { recursive: true });
const SRC = path.join(repo, "src") + path.sep;

// Rebuilt bundles by basename, with their text, length and an absolute-source map.
const bundles = new Map(); // basename -> [{ text, map }]
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
for (const f of walk(mapsRoot).filter((f) => f.endsWith(".mjs"))) {
  const text = fs.readFileSync(f, "utf8");
  const map = JSON.parse(fs.readFileSync(`${f}.map`, "utf8"));
  map.sources = map.sources.map((s) => path.resolve(path.dirname(f), s).replace(mapsRoot, "MAPS"));
  // Maps sit two or three levels under mapsRoot/<plugin>; esbuild wrote sources relative to the
  // map, so resolve them against the scratch repo's layout instead.
  map.sources = map.sources.map((s) => { const i = s.indexOf("/src/"); return i >= 0 ? path.join(repo, s.slice(i + 1)) : s; });
  map.sourceRoot = "";
  const list = bundles.get(path.basename(f)) ?? [];
  list.push({ text, map, file: f });
  bundles.set(path.basename(f), list);
}

function urlPath(url) { try { return url.startsWith("file:") ? fileURLToPath(url) : url; } catch { return url; } }
const summary = { testDirs: 0, rawFiles: 0, processesWithSrc: 0, scripts: { src: 0, bundleMapped: 0, bundleUnmapped: 0 }, unmapped: {} };

(async () => {
  for (const dir of fs.readdirSync(rawRoot)) {
    const files = fs.readdirSync(path.join(rawRoot, dir)).filter((f) => f.endsWith(".json"));
    summary.testDirs++;
    const covs = [];
    const smc = {};
    for (const f of files) {
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(rawRoot, dir, f), "utf8")); } catch { continue; }
      summary.rawFiles++;
      const keep = j.result.filter((s) => { const p = urlPath(s.url); return p.startsWith(SRC) || /\.mjs$/.test(p) && bundles.has(path.basename(p)); });
      if (keep.some((s) => urlPath(s.url).startsWith(SRC))) summary.processesWithSrc++;
      Object.assign(smc, j["source-map-cache"] ?? {});
      if (keep.length) covs.push({ result: keep });
    }
    if (!covs.length) continue;
    const merged = mergeProcessCovs(covs);
    const map = libCoverage.createCoverageMap({});
    for (const script of merged.result) {
      const p = urlPath(script.url);
      let sources;
      if (p.startsWith(SRC)) {
        const c = smc[script.url];
        if (!c?.data) continue;
        sources = { sourceMap: { sourcemap: c.data }, source: c.lineLengths.map((n) => "".padEnd(n, ".")).join("\n") + "\n" };
        summary.scripts.src++;
      } else {
        const len = Math.max(...script.functions.flatMap((fn) => fn.ranges.map((r) => r.endOffset)));
        const hit = bundles.get(path.basename(p)).find((b) => b.text.length === len);
        if (!hit) { summary.scripts.bundleUnmapped++; summary.unmapped[p] = len; continue; }
        sources = { sourceMap: { sourcemap: hit.map }, source: hit.text };
        summary.scripts.bundleMapped++;
      }
      const conv = v8toIstanbul(p, 0, sources, (file) => !path.resolve(file).startsWith(SRC));
      await conv.load();
      conv.applyCoverage(script.functions);
      map.merge(conv.toIstanbul());
    }
    fs.writeFileSync(path.join(outRoot, `${dir}.json`), JSON.stringify(map.toJSON()));
  }
  fs.writeFileSync(path.join(outRoot, "_summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, unmapped: Object.keys(summary.unmapped).length }));
})();
