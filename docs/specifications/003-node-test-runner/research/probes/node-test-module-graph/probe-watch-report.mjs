// THROWAWAY probe. Node's own dependency reporting (WATCH_REPORT_DEPENDENCIES + an IPC channel), the
// mechanism `node --test --watch` uses, driven by a parent we own. One test file, in-process isolation.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
const root = realpathSync(process.argv[2] ?? "fixtures/ref"), pkg = join(root, "packages/core");
const iso = process.versions.node.startsWith("22.") ? "--experimental-test-isolation=none" : "--test-isolation=none";
for (const files of [["test/unit/edge.test.ts"], ["test/unit/edge.test.ts", "test/unit/t000.test.ts"]]) {
  const child = spawn(process.execPath, ["--import", "../../scripts/test-git-env.mjs", "--import", "tsx", "--test", iso, "--test-reporter=dot", ...files],
    { cwd: pkg, env: { ...process.env, WATCH_REPORT_DEPENDENCIES: "1" }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const got = { import: new Set(), require: new Set() };
  child.on("message", (m) => { for (const k of ["import", "require"]) for (const u of m[`watch:${k}`] ?? []) got[k].add(String(u).replace(/.*fixtures\/ref\//, "").replace(/.*node_modules\//, "nm:")); });
  await new Promise((r) => child.on("exit", r));
  const proj = (s) => [...s].filter((u) => !u.startsWith("nm:") && !u.startsWith("node:"));
  console.log(process.version, files.length, "file(s): import", got.import.size, "project", proj(got.import).length, "| require", got.require.size, "project", proj(got.require));
  console.log("  has preload:", proj(got.import).filter((u) => u.startsWith("scripts")), "has computed var-target:", proj(got.import).some((u) => u.includes("var-target")), "has cjs:", [...got.import, ...got.require].filter((u) => u.includes("legacy")));
}
