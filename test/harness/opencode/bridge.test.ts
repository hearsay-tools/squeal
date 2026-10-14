import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { harnessOf } from "../../../src/core/delivery/index.js";
import { storePaths } from "../../../src/core/store/index.js";
import { MAIN_AGENT } from "../../../src/core/types/index.js";
import {
  bridgeDeps,
  end,
  opencodeCommand,
  register,
  runBridge,
} from "../../../src/harness/opencode/bridge.js";
import type { OcConsumer } from "../../../src/harness/opencode/protocol.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { outsideGit } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * The bridge's side of spec 008 D2, D3 and D4 on the shared code: register a
 * root as `(session, "main")` and a child as `(root, child)`; silence without
 * a store, a config or a readable schema; unregister on `session.deleted`
 * and `dispose`.
 */

const CHILD = "ses_ec4f61774ffeIWyJMttM94R8E9";
const BUNDLE = new URL("file:///pkg/dist/hooks/opencode.mjs");

let ensured = 0;
function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  ensured = 0;
  return {
    ...bridgeDeps(BUNDLE, { worktree: "/", pid: process.pid }),
    env: {},
    ensureDaemon: async () => {
      ensured++;
      return "alive";
    },
    ...overrides,
  };
}

const ROOT: OcConsumer = { sessionId: SESSION };
const child: OcConsumer = { sessionId: SESSION, agentId: CHILD };

const reg = (worktree: string, consumer: OcConsumer = ROOT, d = deps()) =>
  register({ kind: "register", consumer, worktree, pid: process.pid }, d);

const registered = (r: SquealRepo, agentId = MAIN_AGENT) =>
  r.store.consumers.get(r.consumer(agentId)) !== null;

function noStore(): SquealRepo {
  const r = squealRepo();
  r.store.close();
  rmSync(join(r.repo.commonDir, "squeal"), { recursive: true });
  return r;
}

describe("register", () => {
  it("registers a root session as (session, main) and answers the header", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const { header } = await reg(r.root);
    expect(header).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expect(registered(r)).toBe(true);
    expect(ensured).toBe(1);
  });

  it("registers a child session as (root, child), leaving the root alone", async () => {
    const r = squealRepo();
    expect((await reg(r.root, child)).header).toMatch(/^SQUEAL · registered/);
    expect(registered(r, CHILD)).toBe(true);
    expect(registered(r)).toBe(false);
  });

  it("records OpenCode's process, the pid the plugin sent, as the harness process", async () => {
    const r = squealRepo();
    await reg(r.root);
    expect(harnessOf(r.store, r.consumer())?.pid).toBe(process.pid);
  });

  it("names the CLI by the Node running the bridge and the package's path", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    await reg(r.root);
    r.apply(r.fail());
    const { header } = await reg(r.root);
    expect(header).toContain(opencodeCommand("/pkg/dist/cli/squeal.mjs"));
  });

  it("is silent, and starts no daemon, where neither a store nor a config exists", async () => {
    expect(await reg(noStore().root)).toEqual({ header: null });
    expect(ensured).toBe(0);
  });

  it("is silent outside a git worktree", async () => {
    expect(await reg(outsideGit())).toEqual({ header: null });
    expect(ensured).toBe(0);
  });

  it("is silent with a config and no store, and ensures the daemon", async () => {
    const r = noStore();
    writeFileSync(join(r.root, "squeal.config.json"), "{}\n");
    expect(await reg(r.root)).toEqual({ header: null });
    expect(ensured).toBe(1);
  });

  it("is silent on a store with a newer schema", async () => {
    const r = squealRepo();
    r.store.close();
    const db = new DatabaseSync(storePaths(r.repo.commonDir).database);
    db.exec("PRAGMA user_version = 999");
    db.close();
    expect(await reg(r.root)).toEqual({ header: null });
  });
});

describe("end", () => {
  const endOf = (r: SquealRepo | string, consumers: OcConsumer[]) =>
    end(
      { kind: "end", consumers, worktree: typeof r === "string" ? r : r.root, pid: process.pid },
      deps(),
    );

  it("ends a root session: its main agent and every child", async () => {
    const r = squealRepo();
    await reg(r.root);
    await reg(r.root, child);
    expect(await endOf(r, [ROOT])).toEqual({ ended: 1 });
    expect(registered(r)).toBe(false);
    expect(registered(r, CHILD)).toBe(false);
  });

  it("ends a child session alone", async () => {
    const r = squealRepo();
    await reg(r.root);
    await reg(r.root, child);
    await endOf(r, [child]);
    expect(registered(r, CHILD)).toBe(false);
    expect(registered(r)).toBe(true);
  });

  it("is silent outside a git worktree and without a store", async () => {
    expect(await endOf(outsideGit(), [ROOT])).toEqual({ ended: 0 });
    expect(await endOf(noStore(), [ROOT])).toEqual({ ended: 1 });
  });
});

describe("runBridge", () => {
  const written: string[] = [];
  afterEach(() => {
    written.length = 0;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });
  const capture = () =>
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

  it("prints the answer to one request", async () => {
    capture();
    await runBridge(JSON.stringify({ kind: "ping", worktree: "/", pid: process.pid }), BUNDLE);
    expect(written).toEqual(['{"answer":{"pong":true}}']);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints nothing and exits 1 on a request that does not parse", async () => {
    capture();
    await runBridge("{", BUNDLE);
    expect(written).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});

describe("bridgeDeps", () => {
  it("finds the CLI beside the bridge's directory", () => {
    expect(bridgeDeps(BUNDLE, { worktree: "/", pid: 1 }).cli).toBe("/pkg/dist/cli/squeal.mjs");
  });
});
