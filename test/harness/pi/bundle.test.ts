import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storePaths } from "../../../src/core/store/index.js";
import { waiterLockState } from "../../../src/core/waiter-lock/index.js";
import { tempDir } from "../../store/helpers.js";
import { liveSocket, quietCli, runNode, runtimeDir } from "../bundle-helpers.js";
import { SESSION, squealRepo } from "../helpers.js";
import { buildPiBundles } from "./helpers.js";

/*
 * Spec 009 D1, D4 and goal 6: the built `dist/extension.mjs` loads in plain
 * Node against a stub `pi` API, registers through its worker, and holds
 * nothing that keeps Node alive, with or without `session_shutdown`.
 */

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildPiBundles();
}, 60_000);
afterAll(() => built.cleanup());

/**
 * A Pi stand-in in `mode`: imports the extension, fires `session_start`
 * twice, in `rpc` `agent_settled` (arming the idle wake, D5) and, with
 * `shutdown`, `session_shutdown(quit)`, then prints what was sent and when,
 * and leaves the process to exit on its own.
 */
const HOST = `
const [extension, cwd, session, shutdown, mode] = process.argv.slice(2);
const { default: factory } = await import(extension);
const handlers = new Map();
const sent = [];
factory({ on: (event, handler) => handlers.set(event, handler), sendMessage: (message, options) => sent.push({ message, options }) });
const ctx = { mode, cwd, sessionManager: { getSessionId: () => session } };
await handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
await handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
if (mode === "rpc") {
  await handlers.get("agent_settled")({ type: "agent_settled" }, ctx);
  // The wake's waiter holds its lock once armed.
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (shutdown === "1") await handlers.get("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);
process.stdout.write(JSON.stringify({ sent, doneAt: performance.now() }));
`;

async function runHost(shutdown: boolean, mode: "print" | "rpc" = "print") {
  const r = squealRepo();
  r.apply(r.fail());
  const dir = runtimeDir();
  await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
  const quiet = quietCli();
  const script = join(tempDir("squeal-pi-host-"), "host.mjs");
  writeFileSync(script, HOST);
  const out = await runNode(
    [script, join(built.dir, "extension.mjs"), r.root, SESSION, shutdown ? "1" : "0", mode],
    "",
    { XDG_RUNTIME_DIR: dir, SQUEAL_CLI: quiet.cli },
  );
  const printed = JSON.parse(out.stdout) as {
    sent: {
      message: { customType: string; content: string; display: boolean };
      options: unknown;
    }[];
    doneAt: number;
  };
  return { r, out, printed, spawnedDaemon: existsSync(quiet.ran) };
}

describe("dist/extension.mjs in plain Node", () => {
  it("registers once, queues the header, unregisters at shutdown, and lets Node exit", async () => {
    const { r, out, printed, spawnedDaemon } = await runHost(true);
    expect(out.stderr).toBe("");
    expect(out.code).toBe(0);
    expect(printed.sent).toHaveLength(1);
    expect(printed.sent[0]).toMatchObject({
      message: { customType: "squeal", display: true },
      options: { deliverAs: "nextTurn" },
    });
    expect(printed.sent[0]?.message.content).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expect(r.store.consumers.get(r.consumer())).toBeNull();
    expect(spawnedDaemon).toBe(false);
    // Exit follows the last handler at once: no worker, timer or socket is left referenced.
    expect(out.ms - printed.doneAt).toBeLessThan(1_000);
  }, 30_000);

  it("lets Node exit without a session_shutdown, leaving the consumer registered", async () => {
    const { r, out, printed } = await runHost(false);
    expect(out.code).toBe(0);
    expect(printed.sent).toHaveLength(1);
    expect(r.store.consumers.get(r.consumer())).not.toBeNull();
    expect(out.ms - printed.doneAt).toBeLessThan(1_000);
  }, 30_000);

  it.each([true, false])(
    "rpc: an armed idle wake holds nothing, so Node exits (session_shutdown: %s)",
    async (shutdown) => {
      const { r, out, printed } = await runHost(shutdown, "rpc");
      expect(out.stderr).toBe("");
      expect(out.code).toBe(0);
      // Armed, the wake took its lock; the shutdown's cancel released it and the unregistration
      // removed its file. Without one, the exit released it and the file stays for expiry.
      expect(waiterLockState(storePaths(r.repo.commonDir).locksDir, r.consumer())).toBe(
        shutdown ? "absent" : "free",
      );
      expect(out.ms - printed.doneAt).toBeLessThan(1_000);
    },
    30_000,
  );
});
