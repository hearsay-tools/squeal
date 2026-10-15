import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BridgeCommand,
  bridgeStart,
  callBridge,
} from "../../../src/harness/opencode/bridge-client.js";
import { tempDir } from "../../store/helpers.js";
import { alive } from "./stub.js";

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

const CLIENT = resolve(import.meta.dirname, "../../../src/harness/opencode/bridge-client.ts");
const BUN =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bun"))
    .find((path) => path !== "bun" && existsSync(path)) ?? null;

/**
 * Each test's pid files, outside `tempDir` so its cleanup cannot remove them
 * first: whatever they name is killed after the test, passed or failed, so a
 * red run leaves no stalled bridge or grandchild behind.
 */
const pidFiles: string[] = [];

/** A file a bridge records its pids in, as `[leader, grandchild]`. */
function pidFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "squeal-oc-pids-")), "pids.json");
  pidFiles.push(path);
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of pidFiles.splice(0)) {
    const pids = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as number[]) : [];
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone, as a passing test leaves it.
      }
    }
    rmSync(dirname(path), { recursive: true, force: true });
  }
});

/** A bridge that starts a grandchild in its group, records both pids in `pids`, then stalls. */
function stallingBridge(pids: string): BridgeCommand {
  return bridge(`
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  `);
}

describe("callBridge", () => {
  it("writes the event to stdin and resolves the answer, in cwd", async () => {
    const cwd = tempDir("squeal-oc-cwd-");
    expect(await callBridge(bridge(ECHO), { kind: "ping" }, cwd, 5_000)).toEqual({
      got: { kind: "ping" },
      cwd,
    });
  });

  it("is silent at its deadline when the bridge never answers, its process group gone", async () => {
    const pids = pidFile();
    const stalled = stallingBridge(pids);
    const started = performance.now();
    expect(await callBridge(stalled, {}, tempDir("squeal-oc-cwd-"), 1_000)).toBeNull();
    const ms = performance.now() - started;
    expect(ms).toBeGreaterThanOrEqual(995);
    expect(ms).toBeLessThan(1_500);
    const [leader, grandchild] = JSON.parse(readFileSync(pids, "utf8")) as [number, number];
    await expect.poll(() => alive(leader) || alive(grandchild), { timeout: 2_000 }).toBe(false);
  });

  it("answers at the bridge's exit when a descendant holds its stdout, then kills the group (review 008-15)", async () => {
    const pids = pidFile();
    const leaking = bridge(`
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "ignore"] });
      writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
      process.stdout.write('{"answer":{"ok":true}}');
      child.unref();
    `);
    const started = performance.now();
    expect(await callBridge(leaking, {}, tempDir("squeal-oc-cwd-"), 3_000)).toEqual({ ok: true });
    expect(performance.now() - started).toBeLessThan(1_500);
    const [, grandchild] = JSON.parse(readFileSync(pids, "utf8")) as [number, number];
    await expect.poll(() => alive(grandchild), { timeout: 2_000 }).toBe(false);
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

  it("starts the bridge without Node's proxy setup, and hands NODE_USE_ENV_PROXY to what it spawns (008-21)", async () => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    // Node sets the proxy up only when a proxy URL is set too, as on a host behind one; CI has none.
    vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:3128");
    // What the bridge sees, whether Node set up the proxy at its start, and what a child sees.
    const probe = bridge(`
      import { execFileSync } from "node:child_process";
      const proxyAtStart = process.moduleLoadList.includes("NativeModule _http_agent");
      const child = execFileSync(process.execPath, ["-p", "process.env.NODE_USE_ENV_PROXY"], { encoding: "utf8" }).trim();
      const carried = Object.keys(process.env).filter((name) => name.startsWith("SQUEAL_CARRIED"));
      process.stdout.write(JSON.stringify({ answer: { switch: process.env.NODE_USE_ENV_PROXY, proxyAtStart, child, carried } }));
    `);
    expect(await callBridge(probe, {}, tempDir("squeal-oc-cwd-"), 10_000)).toEqual({
      switch: "1",
      proxyAtStart: false,
      child: "1",
      carried: [],
    });
    // The control: the same entry run as before 008-21 does set the proxy up, on a Node that has it.
    const plain = JSON.parse(
      execFileSync(process.execPath, [probe.entry], { encoding: "utf8" }),
    ) as {
      answer: { proxyAtStart: boolean };
    };
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    if (major > 24 || (major === 24 && minor >= 5)) expect(plain.answer.proxyAtStart).toBe(true);
  });

  it("leaves an environment without NODE_USE_ENV_PROXY as it is", () => {
    const env = { PATH: "/usr/bin", HTTPS_PROXY: "http://proxy.invalid:3128" };
    expect(bridgeStart("/b.mjs", env)).toEqual({
      args: ["--disable-warning=ExperimentalWarning", "/b.mjs"],
      env,
    });
    const carried = bridgeStart("/b.mjs", { ...env, NODE_USE_ENV_PROXY: "1" });
    expect(carried.env).toEqual({ ...env, SQUEAL_CARRIED_NODE_USE_ENV_PROXY: "1" });
    expect(carried.args.at(-1)).toBe("/b.mjs");
  });

  it.skipIf(BUN === null)(
    "under Bun, OpenCode's runtime, kills the stalled bridge's group at its deadline",
    async () => {
      const pids = pidFile();
      const stalled = stallingBridge(pids);
      const script = join(tempDir("squeal-oc-bun-"), "call.ts");
      writeFileSync(
        script,
        `import { callBridge } from ${JSON.stringify(CLIENT)};
const started = performance.now();
const answer = await callBridge(${JSON.stringify(stalled)}, {}, process.cwd(), 1_000);
process.stdout.write(JSON.stringify({ answer, ms: performance.now() - started }));`,
      );
      const out = JSON.parse(execFileSync(BUN ?? "", [script], { encoding: "utf8" })) as {
        answer: unknown;
        ms: number;
      };
      expect(out.answer).toBeNull();
      expect(out.ms).toBeLessThan(1_500);
      const [leader, grandchild] = JSON.parse(readFileSync(pids, "utf8")) as [number, number];
      await expect.poll(() => alive(leader) || alive(grandchild), { timeout: 2_000 }).toBe(false);
    },
  );
});
