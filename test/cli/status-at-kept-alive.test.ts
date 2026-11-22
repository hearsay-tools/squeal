import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The 0.1.594 boat.dev measurement (row 023-40, `tasks/023-40d-measure.md`):
 * a second `status --at --run` call exited 13 with no output when the
 * worktree daemon's sync stayed pending, because the CLI awaited a promise
 * that only unref'd sleeps kept going. `keptAlive` holds the process.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const MODULE = pathToFileURL(
  new URL("../../src/cli/status-at-now-ask.ts", import.meta.url).pathname,
).href;

/** A child whose only pending work is an unref'd 300 ms sleep, awaited at top level. */
function child(wrapped: boolean) {
  const script = [
    `import { setTimeout as sleep } from "node:timers/promises";`,
    `import { keptAlive } from ${JSON.stringify(MODULE)};`,
    `const pending = sleep(300, "done", { ref: false });`,
    `const got = await ${wrapped ? "keptAlive(pending)" : "pending"};`,
    "console.log(got);",
  ].join("\n");
  return spawnSync(process.execPath, ["--import", TSX, "--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("keptAlive (0.1.594 measurement: exit 13 on a pending sync)", () => {
  it("keeps the process until an unref'd wait settles, where a bare await exits 13", () => {
    const bare = child(false);
    expect(bare.status).toBe(13);
    expect(bare.stdout).toBe("");
    const kept = child(true);
    expect(kept.status).toBe(0);
    expect(kept.stdout.trim()).toBe("done");
  }, 120_000);
});
