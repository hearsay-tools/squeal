import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const root = process.cwd();
const req = createRequire(resolve(root, "package.json"));
const { acquireLock } = await import(
  pathToFileURL(resolve(root, "src/harness/codex/runtime-update/lock.ts")).href
);
if (process.argv[2] === "child") {
  const attempt = await acquireLock(process.argv[3]);
  if ("lock" in attempt) {
    attempt.lock.release();
    throw new Error("Unexpected second holder");
  }
  console.log(JSON.stringify(attempt));
} else {
  const data = mkdtempSync("/tmp/squeal-lock-window-");
  try {
    let before;
    const held = await acquireLock(data, {
      now: () => {
        const child = spawnSync(
          process.execPath,
          ["--import", req.resolve("tsx"), process.argv[1], "child", data],
          { encoding: "utf8", timeout: 10000 },
        );
        if (child.status !== 0) throw new Error(child.stderr);
        before = JSON.parse(child.stdout);
        return Date.now();
      },
    });
    if (!("lock" in held)) throw new Error("No holder");
    const after = await acquireLock(data);
    console.log(
      JSON.stringify({
        node: process.version,
        beforePublication: before,
        afterPublication: after,
        holder: process.pid,
      }),
    );
    held.lock.release();
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}
