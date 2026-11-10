// Throwaway research probe. No browser, server, build, daemon or external checkout.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const repo = resolve(here, "../../..");
const runtime =
  process.argv[2] ??
  "/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs";
const load = loadavg()[0];
console.log(
  JSON.stringify({
    started: new Date().toISOString(),
    load,
    cpus: cpus().length,
    node: process.version,
    runtime,
  }),
);
if (load > cpus().length) {
  console.log("SKIPPED: one-minute load exceeds CPU count");
  process.exit(0);
}
mkdirSync(join(here, ".scratch"), { recursive: true });
const root = mkdtempSync(join(here, ".scratch/case-"));
const write = (path, contents) => {
  mkdirSync(resolve(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), contents);
};
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
write(".gitignore", "node_modules/\nmarker.log\n");
write(
  "package.json",
  JSON.stringify({
    name: "issue-172-probe",
    private: true,
    type: "module",
    devDependencies: { vitest: "5.0.3" },
  }),
);
write(
  "squeal.config.json",
  JSON.stringify({
    inputs: { "test/browser.test.ts": ["src/**"] },
    checks: [
      { name: "browser", runner: "vitest", project: "browser", at: "manual" },
      { name: "server", runner: "vitest", project: "server", at: "edit" },
    ],
  }),
);
write(
  "browser-setup.ts",
  `import { appendFileSync } from 'node:fs';
export default function setup() {
  appendFileSync('marker.log', 'browser-setup\\n');
  process.stderr.write('ISSUE172_BROWSER_SETUP\\n');
}
`,
);
const config = (rootSetup = false) => `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  ${rootSetup ? "globalSetup: ['./browser-setup.ts']," : ""}
  maxWorkers: 1,
  projects: [
    { test: { name: 'server', include: ['test/server.test.ts'], maxWorkers: 1 } },
    { test: { name: 'browser', include: ['test/browser.test.ts'], maxWorkers: 1,
      ${rootSetup ? "" : "globalSetup: ['./browser-setup.ts'],"}
    } }
  ]
} });
`;
const browser = (imports) => `import { it, expect } from 'vitest';
${imports ? "import { double } from '../src/math';" : ""}
it('harmless browser stand-in', () => expect(${imports ? "double(2)" : "4"}).toBe(4));
`;
write(
  "test/server.test.ts",
  `import { it, expect } from 'vitest';
import { double } from '../src/math';
it('server', () => expect(double(2)).toBe(4));
`,
);
git("init", "-q", "-b", "main");

async function run(label, imports, explicit, rootSetup = false) {
  const currentLoad = loadavg()[0];
  if (currentLoad > cpus().length) {
    console.log(JSON.stringify({ label, skipped: "load exceeds CPU count", load: currentLoad }));
    return;
  }
  write("src/math.ts", "export function double(x: number): number {\n  return x * 2;\n}\n");
  write("vitest.config.ts", config(rootSetup));
  write("test/browser.test.ts", browser(imports));
  git("add", ".");
  git(
    "-c",
    "user.name=Research Probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "-qm",
    label,
    "--allow-empty",
  );
  write("src/math.ts", "export function double(x: number): number {\n  return x + x;\n}\n");
  write("marker.log", "");
  const args = [
    "--disable-warning=ExperimentalWarning",
    runtime,
    "code",
    "--base",
    "HEAD",
    "--timeout",
    "30",
    "--json",
  ];
  if (explicit) args.push("--test", "test/server.test.ts");
  let stdout = "",
    stderr = "",
    beforeMarker = null;
  const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
    if (beforeMarker === null && stderr.includes("ISSUE172_BROWSER_SETUP")) {
      beforeMarker = { stdout, stderrBeforeMarker: stderr.split("ISSUE172_BROWSER_SETUP")[0] };
    }
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 45000);
  const [exit, signal] = await new Promise((done) =>
    child.on("close", (...result) => done(result)),
  );
  clearTimeout(timer);
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    report = { raw: stdout };
  }
  const result = {
    label,
    load: currentLoad,
    command: [process.execPath, ...args],
    exit,
    signal,
    marker: readFileSync(join(root, "marker.log"), "utf8"),
    beforeMarker,
    stderr,
    report,
  };
  writeFileSync(join(here, ".scratch", `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({
      ...result,
      report: {
        versions: report.versions,
        verdict: report.verdict,
        runs: report.runs,
        functions: report.functions,
      },
    }),
  );
}

await run("custom-input-only", false, false);
await run("direct-loader", true, false);
await run("direct-loader-explicit-server", true, true);
await run("root-setup-custom-input-only", false, true, true);
console.log(JSON.stringify({ scratch: root, finished: new Date().toISOString() }));
