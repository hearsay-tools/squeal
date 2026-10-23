import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { harnessOf } from "../../../src/core/delivery/index.js";
import { storePaths } from "../../../src/core/store/index.js";
import { MAIN_AGENT } from "../../../src/core/types/index.js";
import type { StartReason } from "../../../src/harness/pi/protocol.js";
import { shutdownSession, startSession, toolBoundary } from "../../../src/harness/pi/session.js";
import { piCommand, workerDeps } from "../../../src/harness/pi/worker.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { PRIMER_OPENING } from "../../../src/harness/shared/primer.js";
import { outsideGit } from "../bundle-helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * The worker's side of spec 009 D2 and D3 on the shared code: register once
 * per start, by reason; silence without a store, a config or a readable
 * schema; unregister at shutdown.
 */

let ensured = 0;
function deps(overrides: Partial<HookDeps> = {}): HookDeps {
  ensured = 0;
  return {
    ...workerDeps(new URL("file:///pkg/dist/worker.mjs")),
    env: {},
    ensureDaemon: async () => {
      ensured++;
      return "alive";
    },
    ...overrides,
  };
}

const start = (r: SquealRepo | string, reason: StartReason = "startup", d = deps()) =>
  startSession({ sessionId: SESSION, cwd: typeof r === "string" ? r : r.root, reason }, d);

const registered = (r: SquealRepo, agentId = MAIN_AGENT) =>
  r.store.consumers.get(r.consumer(agentId)) !== null;

function noStore(): SquealRepo {
  const r = squealRepo();
  r.store.close();
  rmSync(join(r.repo.commonDir, "squeal"), { recursive: true });
  return r;
}

describe("Pi session start", () => {
  it("registers the session's main agent and returns the header, without the primer", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    const text = await start(r);
    expect(text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    expect(text).not.toContain(PRIMER_OPENING);
    expect(registered(r)).toBe(true);
    expect(ensured).toBe(1);
  });

  it("records Pi's own process as the consumer's harness process", async () => {
    const r = squealRepo();
    await start(r);
    expect(harnessOf(r.store, r.consumer())?.pid).toBe(process.pid);
  });

  it.each<StartReason>(["startup", "resume"])(
    "on %s unregisters every other consumer of the session first",
    async (reason) => {
      const r = squealRepo();
      r.store.consumers.register(r.consumer("a-subagent"), Date.now());
      await start(r, reason);
      expect(registered(r, "a-subagent")).toBe(false);
      expect(registered(r)).toBe(true);
    },
  );

  it.each<StartReason>(["new", "fork"])("on %s leaves other consumers alone", async (reason) => {
    const r = squealRepo();
    r.store.consumers.register(r.consumer("a-subagent"), Date.now());
    await start(r, reason);
    expect(registered(r, "a-subagent")).toBe(true);
  });

  it("on reload keeps a registered consumer's view and says nothing", async () => {
    const r = squealRepo();
    await start(r);
    const before = r.store.consumers.get(r.consumer());
    r.apply(r.fail());
    expect(await start(r, "reload")).toBeNull();
    expect(r.store.consumers.get(r.consumer())).toEqual(before);
    // The failure since is still the consumer's to hear.
    expect(await toolBoundary({ sessionId: SESSION, cwd: r.root }, deps())).toMatch(/FAIL/);
  });

  it("on reload registers a consumer that is not", async () => {
    const r = squealRepo();
    expect(await start(r, "reload")).toMatch(/^SQUEAL · registered/);
    expect(registered(r)).toBe(true);
  });

  it("is silent, and starts no daemon, where neither a store nor a config exists", async () => {
    expect(await start(noStore().root)).toBeNull();
    expect(ensured).toBe(0);
  });

  it("is silent outside a git worktree", async () => {
    expect(await start(outsideGit())).toBeNull();
    expect(ensured).toBe(0);
  });

  it("is silent with a config and no store, and ensures the daemon", async () => {
    const r = noStore();
    writeFileSync(join(r.root, "squeal.config.json"), "{}\n");
    expect(await start(r.root)).toBeNull();
    expect(ensured).toBe(1);
  });

  it("is silent on a store with a newer schema", async () => {
    const r = squealRepo();
    r.store.close();
    const db = new DatabaseSync(storePaths(r.repo.commonDir).database);
    db.exec("PRAGMA user_version = 999");
    db.close();
    expect(await start(r)).toBeNull();
  });
});

describe("Pi session shutdown", () => {
  it("unregisters every consumer of the session", async () => {
    const r = squealRepo();
    await start(r);
    r.store.consumers.register(r.consumer("a-subagent"), Date.now());
    expect(await shutdownSession({ sessionId: SESSION, cwd: r.root }, deps())).toBeNull();
    expect(registered(r)).toBe(false);
    expect(registered(r, "a-subagent")).toBe(false);
  });

  it("is silent outside a git worktree", async () => {
    expect(await shutdownSession({ sessionId: SESSION, cwd: outsideGit() }, deps())).toBeNull();
  });
});

describe("piCommand", () => {
  it("names the Node running Pi and the package's CLI by absolute path", () => {
    expect(piCommand("/pkg/dist/cli/squeal.mjs", "/opt/node/bin/node")).toBe(
      "/opt/node/bin/node --disable-warning=ExperimentalWarning /pkg/dist/cli/squeal.mjs",
    );
  });

  it("finds the CLI beside the worker bundle", () => {
    expect(workerDeps(new URL("file:///pkg/dist/worker.mjs")).cli).toBe("/pkg/dist/cli/squeal.mjs");
  });
});
