import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "../../store/helpers.js";
import { type BundleRun, liveSocket, quietCli, runtimeDir } from "../bundle-helpers.js";
import { SESSION, squealRepo } from "../helpers.js";
import { buildOpencodeBundles } from "./helpers.js";
import { CHILD_ID } from "./stub.js";

/*
 * Spec 008 D1, D4 and goal 6: the built `dist/plugin.mjs` loads in plain Node
 * against a stub `client`, registers a root and a child through the real
 * bridge, and holds nothing that keeps the process alive, with or without
 * `dispose`, an idle wait armed (D5) included. Where Bun is on the PATH it runs under Bun too: OpenCode's
 * runtime, without OpenCode.
 */

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 60_000);
afterAll(() => built.cleanup());

/**
 * An OpenCode stand-in: imports the plugin module, starts it on `dir`, sees
 * the root and its child created, sends each a first message and the child
 * one more, asks the child's shell env, lets the root go idle, which arms
 * the idle wait, with `dispose` disposes, then prints
 * what it saw and leaves the process to exit on its own.
 */
const HOST = `
const [plugin, dir, root, child, dispose] = process.argv.slice(2);
const { default: mod } = await import(plugin);
const logged = [];
const prompted = [];
const client = {
  session: {
    get: async () => ({ error: { name: "NotFoundError" } }),
    promptAsync: async ({ body }) => { prompted.push(body); return { data: undefined }; },
  },
  app: { log: async ({ body }) => { logged.push(body.message); } },
};
const hooks = await mod.server({ client, directory: dir, worktree: dir });
const created = (id, parentID) => ({ event: { type: "session.created", properties: { info: { id, parentID } } } });
await hooks.event(created(root));
await hooks.event(created(child, root));
const message = (sessionID, id) => ({ message: { id, sessionID }, parts: [] });
const outputs = [message(root, "msg_1"), message(child, "msg_2"), message(child, "msg_3")];
for (const output of outputs) await hooks["chat.message"]({ sessionID: output.message.sessionID }, output);
const shell = { env: {} };
await hooks["shell.env"]({ cwd: dir, sessionID: child, callID: "call_1" }, shell);
await hooks.event({ event: { type: "session.idle", properties: { sessionID: root } } });
if (dispose === "1") await hooks.dispose();
process.stdout.write(JSON.stringify({
  id: mod.id,
  hooks: Object.keys(hooks).sort(),
  parts: outputs.map((o) => o.parts),
  env: shell.env,
  logged,
  prompted,
  doneAt: performance.now(),
}));
`;

interface Printed {
  id: string;
  hooks: string[];
  parts: { type: string; text: string; synthetic: boolean; id: string }[][];
  env: Record<string, string>;
  logged: string[];
  prompted: unknown[];
  doneAt: number;
}

function run(command: string, args: readonly string[], env: Record<string, string>) {
  return new Promise<BundleRun>((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code, ms: performance.now() - started }));
    child.stdin.end();
  });
}

async function runHost(runtime: string, dispose: boolean) {
  const r = squealRepo();
  r.apply(r.fail());
  const dir = runtimeDir();
  await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
  const quiet = quietCli();
  const script = join(tempDir("squeal-oc-host-"), "host.mjs");
  writeFileSync(script, HOST);
  const out = await run(
    runtime,
    [script, join(built.dir, "plugin.mjs"), r.root, SESSION, CHILD_ID, dispose ? "1" : "0"],
    { XDG_RUNTIME_DIR: dir, SQUEAL_CLI: quiet.cli },
  );
  expect(out.stderr).toBe("");
  return {
    r,
    out,
    printed: JSON.parse(out.stdout) as Printed,
    spawnedDaemon: existsSync(quiet.ran),
  };
}

/** Bun, when on the PATH: `bun --version` answers. */
function bun(): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir !== "" && existsSync(join(dir, "bun"))) return join(dir, "bun");
  }
  return null;
}

const runtimes: [string, string | null][] = [
  ["node", process.execPath],
  ["bun", bun()],
];

describe.each(runtimes)("dist/plugin.mjs in %s", (name, runtime) => {
  it.skipIf(runtime === null)(
    "registers a root and a child once each, names the child in its shell, and unregisters at dispose",
    async () => {
      const { r, out, printed, spawnedDaemon } = await runHost(runtime ?? "", true);
      expect(out.code).toBe(0);
      expect(printed.id).toBe("squeal");
      expect(printed.hooks).toEqual([
        "chat.message",
        "dispose",
        "event",
        "experimental.chat.system.transform",
        "shell.env",
        "tool.execute.after",
        "tool.execute.before",
      ]);
      expect(printed.parts.map((parts) => parts.length)).toEqual([1, 1, 0]);
      for (const [part] of printed.parts.slice(0, 2)) {
        expect(part).toMatchObject({ type: "text", synthetic: true });
        expect(part?.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
        expect(part?.id).toMatch(/^prt_/);
      }
      expect(printed.env).toEqual({
        PATH: expect.stringMatching(new RegExp(`^${join(built.dir, "..", "bin")}:`)),
        OPENCODE_SESSION_ID: SESSION,
        OPENCODE_AGENT_ID: CHILD_ID,
      });
      expect(printed.logged).toEqual([]);
      // The registration said the failure; the idle has no news, so no continuation.
      expect(printed.prompted).toEqual([]);
      expect(r.store.consumers.get(r.consumer())).toBeNull();
      expect(r.store.consumers.get(r.consumer(CHILD_ID))).toBeNull();
      expect(spawnedDaemon).toBe(false);
      // Exit follows the last hook at once: no child, timer or pipe is left referenced.
      expect(out.ms - printed.doneAt, name).toBeLessThan(1_000);
    },
    30_000,
  );

  it.skipIf(runtime === null)(
    "lets the process exit without dispose, leaving both consumers registered",
    async () => {
      const { r, out, printed } = await runHost(runtime ?? "", false);
      expect(out.code).toBe(0);
      expect(r.store.consumers.get(r.consumer())).not.toBeNull();
      expect(r.store.consumers.get(r.consumer(CHILD_ID))).not.toBeNull();
      expect(out.ms - printed.doneAt, name).toBeLessThan(1_000);
    },
    30_000,
  );
});
