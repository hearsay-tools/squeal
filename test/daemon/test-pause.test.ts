import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resume, stoppedItself, testPause } from "../e2e/restart-evidence.js";

/*
 * Review 001-423, N1: the shipped CLI stopped itself with SIGSTOP whenever
 * `SQUEAL_TEST_PAUSE` named a pause point. It now only publishes the point;
 * the test preload `testPause` loads is what stops it.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const PAUSE = pathToFileURL(
  fileURLToPath(new URL("../../src/core/daemon/test-pause.ts", import.meta.url)),
).href;
const SCRIPT = `const { pauseAt } = await import(${JSON.stringify(PAUSE)}); pauseAt("stop-gap"); console.log("ran on");`;

function pausing(env: Readonly<Record<string, string>>) {
  const child = spawn(process.execPath, ["--import", TSX, "--input-type=module", "-e", SCRIPT], {
    env: { ...process.env, NODE_OPTIONS: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  const exited = new Promise<number | null>((done) => child.on("close", (code) => done(code)));
  return { child, exited, stdout: () => stdout };
}

describe.runIf(process.platform === "linux")("a test pause point (task 001-355)", () => {
  it("never stops a process with SQUEAL_TEST_PAUSE alone", async () => {
    const p = pausing({ SQUEAL_TEST_PAUSE: "stop-gap" });
    expect(await p.exited).toBe(0);
    expect(p.stdout()).toBe("ran on\n");
  }, 30_000);

  it("stops a process the test preload is loaded into, at the point it names", async () => {
    const p = pausing(testPause("stop-gap"));
    const pid = p.child.pid ?? 0;
    const stopped = await stoppedItself(pid, 20_000);
    resume(pid);
    expect(stopped).toBe(true);
    expect(await p.exited).toBe(0);
    expect(p.stdout()).toBe("ran on\n");
  }, 30_000);
});
