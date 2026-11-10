// Throwaway probe (survey-020-15). Builds the shape of hearsay-tools/squeal#172
// in an isolated Git repository under ignored `.scratch/`, then runs the
// packaged `squeal code --base HEAD --json` once per case. No browser, server,
// build or daemon starts: the "browser" project is Node, and its global setup
// only appends a marker. `node_modules` is a symlink to this worktree's.
//
//   node fixture.mjs [<squeal.mjs>]
//
// Each case is skipped while the one-minute load is above 24 (the brief's
// limit), and records the load beside its timing.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";

const LOAD_LIMIT = 24;
const here = import.meta.dirname;
const repo = resolve(here, "../../../../../..");
const runtime =
  process.argv[2] ??
  "/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.427/dist/cli/squeal.mjs";
mkdirSync(join(here, ".scratch"), { recursive: true });

/**
 * shape: "helper" = the browser spec imports a helper that imports the
 * source, and the browser global setup imports the helper too (cezar's
 * workspace-registry.ts); "setup-only" = only the global setup imports it;
 * "root-setup" = "helper" plus a global setup at the Vitest root.
 */
async function run(label, shape, extra = []) {
  const load = loadavg()[0];
  if (load > LOAD_LIMIT) {
    console.log(JSON.stringify({ label, skipped: `one-minute load ${load} > ${LOAD_LIMIT}` }));
    return;
  }
  const root = mkdtempSync(join(here, ".scratch/case-"));
  const write = (path, text) => {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  write(".gitignore", "node_modules/\nmarker.log\n");
  write("package.json", JSON.stringify({ name: "s172", private: true, type: "module" }));
  write(
    "squeal.config.json",
    JSON.stringify({
      checks: [{ name: "browser", runner: "vitest", project: "browser", at: "manual" }],
    }),
  );
  const setup = (who) => `import { appendFileSync } from 'node:fs';
${shape === "plain" ? "" : "import { registry } from './e2e/helper';"}
export default function setup() {
  appendFileSync('marker.log', '${who}\\n');
  process.stdout.write('TEST_ENV_${who.toUpperCase()}=1\\n');
}
`;
  write("browser-setup.ts", setup("browser-setup"));
  write("root-setup.ts", setup("root-setup"));
  write("src/home.ts", "export function store(x: number): number {\n  return x * 2;\n}\n");
  write("e2e/helper.ts", "import { store } from '../src/home';\nexport const registry = () => store(1);\n");
  write(
    "e2e/smoke.e2e.ts",
    `import { it, expect } from 'vitest';
${shape === "setup-only" ? "" : "import { registry } from './helper';"}
it('browser stand-in', () => expect(${shape === "setup-only" ? "2" : "registry()"}).toBe(2));
`,
  );
  write(
    "test/server.test.ts",
    "import { it, expect } from 'vitest';\nimport { store } from '../src/home';\nit('server', () => expect(store(2)).toBe(4));\n",
  );
  write(
    "vitest.config.ts",
    `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  ${shape === "root-setup" ? "globalSetup: ['./root-setup.ts']," : ""}
  maxWorkers: 1,
  projects: [
    { test: { name: 'server', include: ['test/**/*.test.ts'] } },
    { test: { name: 'browser', include: ['e2e/**/*.e2e.ts'], globalSetup: ['./browser-setup.ts'] } },
  ],
} });
`,
  );
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", label);
  write("src/home.ts", "export function store(x: number): number {\n  return x + x;\n}\n");
  write("marker.log", "");
  const args = ["--disable-warning=ExperimentalWarning", runtime, "code", "--base", "HEAD"];
  args.push("--timeout", "60", "--json", ...extra);
  const started = performance.now();
  const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => child.kill("SIGTERM"), 90_000);
  const [exit] = await new Promise((done) => child.on("close", (...r) => done(r)));
  clearTimeout(timer);
  const ms = Math.round(performance.now() - started);
  const brace = stdout.indexOf("{");
  let report = null;
  try {
    report = JSON.parse(stdout.slice(brace));
  } catch {}
  const result = {
    label,
    shape,
    extra,
    load,
    loadAfter: loadavg()[0],
    ms,
    exit,
    marker: readFileSync(join(root, "marker.log"), "utf8"),
    stdoutBeforeJson: stdout.slice(0, Math.max(brace, 0)),
    jsonParsesWhole: (() => {
      try {
        JSON.parse(stdout);
        return true;
      } catch {
        return false;
      }
    })(),
    stderr,
    verdict: report?.verdict,
    runs: report?.runs,
    functions: report?.functions?.map((f) => ({
      name: f.qualifiedName ?? f.name,
      state: f.state,
      gap: f.gap,
      loaders: f.loaders,
    })),
  };
  writeFileSync(join(here, `${label}.out.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ label, exit, ms, load, verdict: result.verdict, marker: result.marker }));
}

await run("helper", "helper");
await run("setup-only", "setup-only");
await run("root-setup", "root-setup");
