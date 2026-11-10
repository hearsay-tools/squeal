// Shaped like cezar's scripts/test-package.mjs: build when stale, then node --test with the project's flags.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const run = (argv) => {
  const r = spawnSync(process.execPath, argv, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!existsSync("dist/stamp.json") || process.env.FORCE_BUILD === "1") {
  console.log("wrapper: building");
  run(["scripts/build.mjs"]);
} else console.log("wrapper: build fresh");
const extra = process.env.WRAP_REPORTER ? [`--test-reporter=${process.env.WRAP_REPORTER}`] : [];
run(["--test", ...extra, ...process.argv.slice(2)]);
