import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIST } from "../../src/harness/claude-code/build.js";

/** Review wave 3, N6: `squeal start | head -1` crashed with an unhandled EPIPE. */
describe("the CLI writing into a closed pipe", () => {
  it("exits without an EPIPE error when the reader goes away", async () => {
    const child = spawn(process.execPath, [join(PLUGIN_DIST, "cli/squeal.mjs"), "--help"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The reader closes before the CLI writes, as `head -1` does after its line.
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(stderr).not.toContain("EPIPE");
    expect(code).toBe(0);
  });
});
