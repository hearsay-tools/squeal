import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BridgeCommand, callBridge } from "../../../src/harness/opencode/bridge-client.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Spec 008 D4: the plugin spawns `node <entry>` per event in its own process
 * group and awaits one JSON answer against a deadline; a missed deadline
 * kills the group, and it, a non-zero exit, bad JSON and a spawn error are
 * silence.
 */

/** A bridge entry from source, run by this Node. */
function bridge(source: string): BridgeCommand {
  const entry = join(tempDir("squeal-oc-bridge-"), "bridge.mjs");
  writeFileSync(entry, source);
  return { node: process.execPath, entry };
}

const ECHO = `
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ answer: { got: JSON.parse(input), cwd: process.cwd() } })));
`;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("callBridge", () => {
  it("writes the event to stdin and resolves the answer, in cwd", async () => {
    const cwd = tempDir("squeal-oc-cwd-");
    expect(await callBridge(bridge(ECHO), { kind: "ping" }, cwd, 5_000)).toEqual({
      got: { kind: "ping" },
      cwd,
    });
  });

  it("is silent at its deadline when the bridge never answers, its process group gone", async () => {
    const pids = join(tempDir("squeal-oc-pids-"), "pids.json");
    // The bridge starts a grandchild in its group, records both pids, then stalls.
    const stalled = bridge(`
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
      setInterval(() => {}, 1000);
    `);
    const started = performance.now();
    expect(await callBridge(stalled, {}, tempDir("squeal-oc-cwd-"), 1_000)).toBeNull();
    const ms = performance.now() - started;
    expect(ms).toBeGreaterThanOrEqual(995);
    expect(ms).toBeLessThan(1_500);
    const [leader, grandchild] = JSON.parse(readFileSync(pids, "utf8")) as [number, number];
    await expect.poll(() => alive(leader) || alive(grandchild), { timeout: 2_000 }).toBe(false);
  });

  it("is silent when the bridge exits non-zero, even after printing an answer", async () => {
    const failing = bridge(`process.stdout.write('{"answer":1}'); process.exitCode = 3;`);
    expect(await callBridge(failing, {}, tempDir("squeal-oc-cwd-"), 5_000)).toBeNull();
  });

  it("is silent on invalid JSON and on JSON with no answer", async () => {
    const cwd = tempDir("squeal-oc-cwd-");
    expect(
      await callBridge(bridge(`process.stdout.write("not json");`), {}, cwd, 5_000),
    ).toBeNull();
    expect(await callBridge(bridge(`process.stdout.write("{}");`), {}, cwd, 5_000)).toBeNull();
  });

  it("is silent when node or the entry is missing", async () => {
    const cwd = tempDir("squeal-oc-cwd-");
    const missingNode = { node: join(cwd, "no-node"), entry: bridge(ECHO).entry };
    expect(await callBridge(missingNode, {}, cwd, 5_000)).toBeNull();
    const missingEntry = { node: process.execPath, entry: join(cwd, "no-bridge.mjs") };
    expect(await callBridge(missingEntry, {}, cwd, 5_000)).toBeNull();
  });

  it("is silent when the bridge exits without reading its stdin", async () => {
    expect(
      await callBridge(
        bridge(`process.exit(0);`),
        { big: "x".repeat(1 << 20) },
        tempDir("squeal-oc-cwd-"),
        5_000,
      ),
    ).toBeNull();
  });
});
