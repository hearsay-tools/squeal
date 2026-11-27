import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import {
  readMachines,
  recordMachine,
  updateMachine,
} from "../../../src/core/runner-host/remote/machines-store.js";
import { machineScope } from "../../../src/core/runner-host/remote/presence.js";
import { type MachineRecord, recordOf } from "../../../src/core/runner-host/remote/provider.js";
import { createAgent37Provider } from "../../../src/core/runner-host/remote/providers/agent37/index.js";
import { pruneRemovedWorktrees } from "../../../src/core/runner-host/remote/prune.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import type { AbsolutePath, WorktreeId } from "../../../src/core/types/common.js";
import { fakeSshAt, mockAgent37Api } from "./providers/agent37-api-mock.js";

/*
 * Row 026-43 (spec 026 D7.3 item 4): an Agent37 instance no daemon used
 * for a day is deleted through the API and forgotten, and the worktree's
 * next daemon acquires a new one: with no record it creates one; with a
 * record of the deleted instance left (its forget failed) Agent37 answers
 * 404 and it creates one. A local Agent37 API and a fake `ssh`, as in
 * `agent37.test.ts`; nothing reaches the network or the real home.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prune-agent37-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const NODE_VERSION = "v99.1.2";
const provider = createAgent37Provider({
  pollMs: 5,
  readyMs: 5_000,
  cli: ["/opt/node", "/opt/squeal dist/cli/squeal.mjs"],
});
const providerOf = (kind: string) => (kind === "agent37" ? provider : null);
let n = 0;

async function setup() {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "worktree") as AbsolutePath;
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      stdio: "pipe",
    });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  const api = await mockAgent37Api();
  onTestFinished(() => api.close());
  const ssh = fakeSshAt(dir);
  const env: NodeJS.ProcessEnv = {
    PATH: `${ssh.bin}:${process.env.PATH}`,
    HOME: join(dir, "no-home"),
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
    AGENT37_API_KEY: "sk_test_prune_unused_7a4c",
  };
  const node = join(ssh.bin, "remote-node");
  writeFileSync(node, `#!/bin/sh\necho ${NODE_VERSION}\n`, { mode: 0o755 });
  const config = { node, cache: ".squeal-remote", apiBaseUrl: api.url };
  mkdirSync(join(dir, "config", "squeal"), { recursive: true });
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({ repositories: { [root]: { provider: "agent37", providerConfig: config } } }),
  );
  const log: string[] = [];
  const request = {
    repositoryKey: root,
    worktreeId: `wt-${n}` as WorktreeId,
    worktreeRoot: root,
    commonDir: join(root, ".git") as AbsolutePath,
    remoteUrls: [],
    nodeVersion: NODE_VERSION,
    log: (line: string) => log.push(line),
    env,
  };
  /** A daemon's start: acquires the worktree's machine and records it, as `machine-share.ts` does. */
  const daemonAcquires = async () => {
    const machine = await provider.acquire(request, config);
    recordMachine(recordOf(machine, request, Date.now()), env);
    return machine;
  };
  return { api, env, log, daemonAcquires };
}

const instanceOf = (record: MachineRecord | undefined) =>
  (record?.state as { instanceId: string } | undefined)?.instanceId;

describe("an Agent37 machine no daemon used for a day (row 026-43)", () => {
  it("is deleted and forgotten; the worktree's next daemon creates a new one", async () => {
    const s = await setup();
    await s.daemonAcquires();
    // The daemon exited a day and an hour ago: its machine asleep, detached since.
    const [record] = readMachines(s.env).machines;
    const first = instanceOf(record) as string;
    s.api.instances.set(first, "sleeping");
    updateMachine(
      record as MachineRecord,
      { status: "detached", detachedAt: Date.now() - 25 * 3_600_000 },
      s.env,
    );
    s.api.calls.length = 0;
    const result = await pruneRemovedWorktrees({
      env: s.env,
      providerOf,
      scope: machineScope(),
      daemonLive: () => false,
    });
    expect(result.outcomes).toMatchObject([{ kind: "released", cause: { kind: "unused" } }]);
    expect(s.api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /v1/instances/${first}`,
    ]);
    expect(s.api.instances.has(first)).toBe(false);
    expect(readMachines(s.env).machines).toEqual([]);

    s.api.calls.length = 0;
    const again = await s.daemonAcquires();
    expect(s.api.calls[0]).toMatchObject({ method: "POST", path: "/v1/instances" });
    expect(instanceOf(readMachines(s.env).machines[0])).not.toBe(first);
    expect(again.id).not.toBe(record?.id);
  });

  it("left tracked after its delete, answers 404 and the next daemon creates a new one", async () => {
    const s = await setup();
    await s.daemonAcquires();
    const [stale] = readMachines(s.env).machines;
    const first = instanceOf(stale) as string;
    // Deleted as unused, but its record could not be forgotten (`released, not forgotten`).
    s.api.instances.delete(first);
    s.api.calls.length = 0;
    await s.daemonAcquires();
    expect(s.api.calls.slice(0, 2).map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /v1/instances/${first}`,
      "POST /v1/instances",
    ]);
    expect(s.log).toContain(`Agent37 instance ${first} is gone; creating another`);
    expect(instanceOf(readMachines(s.env).machines[0])).not.toBe(first);
  });
});
