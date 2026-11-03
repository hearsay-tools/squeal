// Throwaway probe. No product files or live daemon are changed.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const repo = resolve(here, "../../../../../..");
const runtime = join(here, "runtime");
mkdirSync(runtime, { recursive: true });
const release =
  process.argv[2] ?? "/home/agent/.claude/plugins/cache/hearsay/squeal/0.1.392/dist/cli/squeal.mjs";
const original = readFileSync(release, "utf8");
const tagBlob = execFileSync(
  "git",
  ["rev-parse", "squeal--v0.1.392:plugins/claude-code/dist/cli/squeal.mjs"],
  { cwd: repo, encoding: "utf8" },
).trim();
const installedBlob = execFileSync("git", ["hash-object", release], {
  cwd: repo,
  encoding: "utf8",
}).trim();
if (tagBlob !== installedBlob) throw new Error("Installed bundle differs from release tag");
// Export the unchanged bundled functions instead of calling CLI main().
writeFileSync(
  join(runtime, "released.mjs"),
  original.slice(0, original.lastIndexOf("// src/cli/index.ts")) +
    "\ninit_policy(); init_pass3();\nexport { oxlintProvider, createLintPass, openLintStore, DEFAULT_POLICY, blobHash };\n",
);
const { oxlintProvider, createLintPass, openLintStore, DEFAULT_POLICY, blobHash } = await import(
  pathToFileURL(join(runtime, "released.mjs"))
);
const rows = [];
function record(value) {
  rows.push(value);
  console.log(JSON.stringify(value));
  writeFileSync(join(here, "observations.json"), JSON.stringify(rows, null, 2) + "\n");
}
function gate(label) {
  const oneMinute = loadavg()[0];
  const cpuCount = cpus().length;
  record({ gate: label, at: new Date().toISOString(), oneMinute, cpuCount });
  if (oneMinute > cpuCount) throw new Error("Load exceeds CPUs; remaining probes skipped");
}
const root = join(runtime, `fixture-${Date.now()}`);
mkdirSync(join(root, "node_modules"), { recursive: true });
mkdirSync(join(root, "src"));
mkdirSync(join(root, ".git"));
symlinkSync(join(repo, "node_modules/oxlint"), join(root, "node_modules/oxlint"));
const config = {
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: ["./probe-plugin.mjs"],
  rules: { "probe/slow": "error" },
};
writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(config));
writeFileSync(
  join(root, "probe-plugin.mjs"),
  `export default { meta: { name: 'probe' }, rules: { slow: { create(context) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); return { Identifier(node) { if(node.name === 'forbidden') context.report({ node, message: 'seeded finding' }); } }; } } } };\n`,
);
const files = Array.from({ length: 32 }, (_, i) => ({
  path: `src/f${String(i).padStart(2, "0")}.js`,
  text: `export const ${i === 0 ? "forbidden" : `value${i}`} = ${i};\n`,
}));
for (const f of files) writeFileSync(join(root, f.path), f.text);
record({
  version: "0.1.392",
  commit: execFileSync("git", ["rev-parse", "squeal--v0.1.392^{commit}"], {
    encoding: "utf8",
  }).trim(),
  tagBlob,
  node: process.version,
  oxlint: JSON.parse(readFileSync(join(repo, "node_modules/oxlint/package.json"))).version,
  files: files.length,
  perFileWaitMs: 200,
});
const env = { PATH: process.env.PATH };
function summary(report) {
  if ("off" in report) return report;
  const entries = [...report.results];
  return {
    total: entries.length,
    unknown: entries.filter(([, r]) => "unknown" in r).length,
    failing: entries.filter(([, r]) => r.findings?.length > 0).length,
    reasons: [...new Set(entries.flatMap(([, r]) => r.unknown ?? []))],
    first: entries[0],
  };
}
async function timed(label, fn) {
  gate(label);
  const start = performance.now();
  try {
    const result = await fn();
    record({ label, ms: Math.round(performance.now() - start), result });
    return result;
  } catch (error) {
    record({ label, ms: Math.round(performance.now() - start), error: error.message });
    throw error;
  }
}
const provider = oxlintProvider({ root, env });
try {
  await timed("open", () => provider.open());
  await timed("inputs-32", async () => ({
    size: (await provider.inputs(files.map((f) => f.path))).size,
  }));
  await timed("whole-32-default-guard", async () => summary(await provider.lint(files)));
  await timed("subsequent-part-16", async () => summary(await provider.lint(files.slice(0, 16))));
  await timed("subsequent-part-16-rest", async () => summary(await provider.lint(files.slice(16))));
  await timed("repeat-whole-32-default-guard", async () => summary(await provider.lint(files)));
  await timed("direct-whole-32", async () => {
    const args = [
      join(repo, "node_modules/oxlint/bin/oxlint"),
      "--format",
      "json",
      "--threads",
      "1",
      "--",
      ...files.map((f) => f.path),
    ];
    let output;
    let code = 0;
    try {
      output = execFileSync(process.execPath, args, {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 20000,
      });
    } catch (error) {
      if (error.status !== 1) throw error;
      output = error.stdout;
      code = error.status;
    }
    const json = JSON.parse(output);
    return {
      code,
      number_of_files: json.number_of_files,
      diagnostics: json.diagnostics.length,
      diagnostic: json.diagnostics[0],
    };
  });
} finally {
  await provider.close();
}
const policy = {
  ...DEFAULT_POLICY,
  lint: { ...DEFAULT_POLICY.lint, enabled: true, tools: ["oxlint"], include: ["src/**"] },
};
let revision = 1;
let changed = files.map((f) => f.path);
const allPaths = [".oxlintrc.json", "probe-plugin.mjs", ...files.map((f) => f.path)];
const listing = () =>
  allPaths.map((path) => ({ path, hash: blobHash(readFileSync(join(root, path)), "sha1") }));
const source = {
  latestRevision: () => revision,
  changedPaths: () => changed,
  files: listing,
  file: (path) => listing().find((f) => f.path === path) ?? null,
  ignored: () => [],
};
const calls = [];
const store = openLintStore(join(root, ".git"), policy);
const pass = createLintPass({
  root,
  commonDir: join(root, ".git"),
  worktreeId: "probe",
  tool: "oxlint",
  format: "sha1",
  source,
  policy: () => policy,
  installed: async () => "fixture-install",
  log: () => {},
  onError: (error) => {
    throw error;
  },
  provider: () => {
    const p = oxlintProvider({ root, env });
    return {
      open: (...a) => p.open(...a),
      refresh: (...a) => p.refresh(...a),
      inputs: async (paths) => {
        calls.push({ method: "inputs", count: paths.length });
        return p.inputs(paths);
      },
      lint: async (fs) => {
        calls.push({ method: "lint", count: fs.length });
        return p.lint(fs);
      },
      close: () => p.close(),
    };
  },
});
const states = () => {
  const list = store.states.list("probe");
  return {
    total: list.length,
    counts: list.reduce((a, s) => {
      a[s.outcome] = (a[s.outcome] ?? 0) + 1;
      return a;
    }, {}),
    first: list.find((s) => s.check.path === files[0].path),
    calls: [...calls],
  };
};
try {
  await timed("real-pass-first", async () => {
    pass.nudge();
    await pass.idle();
    return states();
  });
  writeFileSync(join(root, files[0].path), "export const allowed = 0;\n");
  revision++;
  changed = [files[0].path];
  calls.length = 0;
  await timed("real-pass-fix", async () => {
    pass.nudge();
    await pass.idle();
    return states();
  });
} finally {
  await pass.close();
  store.close();
}
