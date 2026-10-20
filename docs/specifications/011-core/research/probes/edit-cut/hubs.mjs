// THROWAWAY probe (011-core/research/edit-cut.md, question 4). How cezar's test files use the
// three widest hubs (`runs/store.ts`, `workflows/run.ts`, `core/harness-parity.testkit.ts`) at
// a8042ec3, the head where 486 of the stored closures were written. For each test file that
// imports a hub in its source (type-only imports included), from the import statement and the
// file's text:
//   type only   every name it imports from the hub is a type: Vite's transform drops the import,
//               so it is no runtime importer and no runner reports it direct;
//   subject     the hub's namesake, or a file whose describe titles name the hub's main export, or that imports no other source module and no testkit;
//   fixture     any other test file that imports a value from the hub: it imports other source
//               modules or a testkit, and its describe titles do not name the hub, so the hub sets
//               up state for another subject (spot-checked by hand, edit-cut.md 4);
//   testkit user  the hub is itself a testkit and the file is not its subject;
//   testkit     not a test file: a helper (`*.testkit.ts`, `test/helpers/…`) that imports the hub,
//               counted with the test files that reach the hub only through it.
// Writes results/hubs.txt and results/hubs.json (the fixture importers per hub, for replay.mjs's
// testkit counterfactual).
import { readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { graphAt, testStem, sourceStem } from "./lib.mjs";

const g = graphAt("cezar", "a8042ec3bd612612a287dcf3646a14f572d1d491");
const HUBS = {
  "packages/cezar/src/runs/store.ts": "RunStore",
  "packages/cezar/src/workflows/run.ts": "RunManager",
  "packages/cezar/src/core/harness-parity.testkit.ts": "SCENARIOS",
};
const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /\.e2e\.ts$/.test(p);
const isKit = (p) => /\.testkit\.[jt]s$/.test(p) || /(^|\/)(test|tests)\/(helpers|support|fixtures)\//.test(p) || /\/__fixtures__\//.test(p);
const lines = [];
const log = (s = "") => { lines.push(s); console.log(s); };
const out = {};

// Source-level imports of `hub` in `file`: the names, and whether each is a type.
function importsOf(file, hub) {
  const text = readFileSync(join(g.dir, file), "utf8");
  const names = [];
  for (const m of text.matchAll(/import\s+(type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[3];
    const target = spec.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.js$/, ".ts") : null;
    if (target !== hub && `${target}.ts` !== hub) continue;
    const whole = Boolean(m[1]);
    for (const n of m[2].replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean)) names.push({ name: n.replace(/^type\s+/, "").split(/\s+as\s+/)[0], type: whole || n.startsWith("type ") });
  }
  return { text, names };
}

for (const [hub, main] of Object.entries(HUBS)) {
  const runtime = new Set([...g.edges].filter(([, e]) => e.has(hub)).map(([f]) => f));
  const importers = [...g.files].filter((f) => f !== hub && /\.[cm]?[jt]sx?$/.test(f) && importsOf(f, hub).names.length);
  const rows = [];
  for (const f of importers) {
    const { text, names } = importsOf(f, hub);
    const otherSrc = [...(g.edges.get(f) ?? [])].filter((p) => p !== hub && !isTest(p) && !isKit(p) && /\/src\//.test(p));
    const usesKit = [...(g.edges.get(f) ?? [])].some((p) => p !== hub && isKit(p));
    const titles = [...text.matchAll(/describe(?:\.\w+)?\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    // The main export's name only: the stem ("store", "run") is a word many titles use.
    const hubWords = [main.toLowerCase()];
    const namesHub = titles.some((t) => hubWords.some((w) => t.toLowerCase().includes(w)));
    const uses = (text.match(new RegExp(`\\b${main}\\b`, "g")) ?? []).length;
    let cls;
    if (!isTest(f)) cls = isKit(f) ? "testkit" : "source";
    else if (names.every((n) => n.type)) cls = "type only";
    else if (testStem(f) === sourceStem(hub) || namesHub || (otherSrc.length === 0 && !usesKit)) cls = "subject";
    else if (isKit(hub)) cls = "testkit user";
    else cls = "fixture";
    rows.push({ file: f, cls, runtime: runtime.has(f), names: names.map((n) => (n.type ? `type ${n.name}` : n.name)), otherSrc: otherSrc.length, uses, title: titles[0] ?? null });
  }
  // Test files that reach the hub only through a testkit that imports it.
  const kits = rows.filter((r) => r.cls === "testkit").map((r) => r.file);
  const viaKit = [...g.files].filter((f) => isTest(f) && !rows.some((r) => r.file === f) && [...(g.edges.get(f) ?? [])].some((p) => kits.includes(p)));
  const count = (c) => rows.filter((r) => r.cls === c).length;
  log(`\n== ${hub} (main export ${main}) at a8042ec3`);
  log(`  importers in source: ${rows.length}; runtime (one hop after the transform): ${runtime.size}`);
  log(`  test files: subject ${count("subject")}, fixture ${count("fixture")}, testkit user ${count("testkit user")}, type only ${count("type only")}; testkits ${count("testkit")} (${kits.join(", ") || "-"}), reaching ${viaKit.length} more test files only through them; source modules ${count("source")}`);
  const runtimeTests = rows.filter((r) => r.runtime && isTest(r.file));
  log(`  runtime test importers by class: ${JSON.stringify(Object.fromEntries(["subject", "fixture", "testkit user", "type only"].map((c) => [c, runtimeTests.filter((r) => r.cls === c).length])))}`);
  for (const c of ["subject", "fixture", "testkit user", "type only", "testkit"]) {
    const xs = rows.filter((r) => r.cls === c);
    log(`  ${c} (${xs.length}), e.g.: ${xs.slice(0, 8).map((r) => `${r.file.replace(/^packages\/[^/]+\//, "")} [${r.names.slice(0, 3).join(", ")}${r.title ? `; "${r.title.slice(0, 40)}"` : ""}]`).join("; ")}`);
  }
  out[hub] = { fixture: rows.filter((r) => r.cls === "fixture" && r.runtime).map((r) => r.file), rows, viaKit };
}
writeFileSync(new URL("results/hubs.json", import.meta.url), JSON.stringify(out, null, 1));
writeFileSync(new URL("results/hubs.txt", import.meta.url), lines.join("\n") + "\n");
