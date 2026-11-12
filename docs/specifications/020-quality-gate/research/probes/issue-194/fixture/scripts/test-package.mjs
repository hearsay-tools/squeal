// Shaped like #194's scripts/test-package.mjs: build, then node --test on the packaged tests. No runner listing has these files.
import { spawnSync } from "node:child_process";
const run = (argv) => {
  const r = spawnSync(process.execPath, argv, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(["scripts/build.mjs"]);
run(["--test", "test/e2e/"]);
