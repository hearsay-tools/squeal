import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDelivery,
  dropLeft,
  lastDeparture,
  leavingMarks,
} from "../../src/core/delivery/index.js";
import { slot } from "../../src/core/delivery/slots.js";
import { storePaths } from "../../src/core/store/index.js";
import { LEAVING_GRACE_MS } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { FILE } from "../state/helpers.js";
import { recorded, type SquealRepo, SUBAGENT, squealRepo } from "./helpers.js";

/*
 * Task 001-416: SubagentStop waits for pending checks before it unregisters,
 * inside a 2 s hook timeout, so under load the harness killed it first and
 * the subagent's registration kept its daemon for hours. It now marks the
 * consumer leaving before it waits; the daemon drops a consumer whose mark
 * outlived `LEAVING_GRACE_MS`, and a block or a later boundary clears it.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const runner = fileURLToPath(new URL("./child/run-hook.ts", import.meta.url));
const deps = (): HookDeps => ({ env: {}, ensureDaemon: async () => "alive" });

const marked = (r: SquealRepo) =>
  leavingMarks(r.store, r.worktreeId).get(slot(r.consumer(SUBAGENT)));
const locksDir = (r: SquealRepo) => storePaths(r.repo.commonDir).locksDir;

/** A registered subagent whose file's re-run is queued, so its SubagentStop waits. */
async function waitingSubagent(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await runHook("session-start", recorded("subagent-start", r.root), deps());
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: FILE, key: "k2", revision: 1, pending: "queued" },
  ]);
  r.sink.refresh(r.worktreeId, 1, { checkpointId: null });
  r.policy({ stop: { waitMs: 1_500 } });
  return r;
}

async function until(condition: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`not met in ${ms} ms`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

describe("a SubagentStop killed at its timeout (task 001-416)", () => {
  it("leaves a consumer the daemon drops within the leaving grace, with its departure", async () => {
    const r = await waitingSubagent();
    const input = JSON.stringify(recorded("subagent-stop", r.root));
    const child = spawn(process.execPath, ["--import", TSX, runner, "stop", input], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<NodeJS.Signals | null>((done) =>
      child.on("close", (_, signal) => done(signal)),
    );
    await until(() => marked(r) !== undefined, 20_000).catch((error: Error) => {
      throw new Error(`${error.message}; the hook's stderr: ${stderr}`);
    });
    child.kill("SIGKILL");
    expect(await exited).toBe("SIGKILL");

    const at = marked(r) ?? 0;
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
    expect(
      dropLeft(r.store, r.worktreeId, at + LEAVING_GRACE_MS, { locksDir: locksDir(r) }),
    ).toEqual([]);
    const later = at + LEAVING_GRACE_MS + 1;
    expect(dropLeft(r.store, r.worktreeId, later, { locksDir: locksDir(r) })).toEqual([
      r.consumer(SUBAGENT),
    ]);
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).toBeNull();
    expect(lastDeparture(r.store, r.worktreeId)).toBe(later);
    expect(marked(r)).toBeUndefined();
  }, 30_000);

  it("is marked while it waits, and unregistered with no mark once it finishes", async () => {
    const r = await waitingSubagent();
    const stopping = runHook("stop", recorded("subagent-stop", r.root), deps());
    await until(() => marked(r) !== undefined, 5_000);
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
    await stopping;
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).toBeNull();
    expect(marked(r)).toBeUndefined();
  });
});

describe("a leaving mark", () => {
  it("is cleared by a block, which keeps the subagent registered", async () => {
    const r = squealRepo();
    r.apply(r.fail());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    r.policy({ stop: { blockOnKnownFailures: true } });

    const blocked = await runHook("stop", recorded("subagent-stop", r.root), deps());

    expect(JSON.parse(blocked.stdout)).toMatchObject({ decision: "block" });
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
    expect(marked(r)).toBeUndefined();
  });

  it("is cleared by a later tool boundary, so a subagent that kept working is never dropped", async () => {
    const r = await waitingSubagent();
    const stopping = runHook("stop", recorded("subagent-stop", r.root), deps());
    await until(() => marked(r) !== undefined, 5_000);
    const delivery = createDelivery(r.store, { status: fixedStatus() });
    await delivery.onToolBoundary(r.consumer(SUBAGENT));
    expect(marked(r)).toBeUndefined();
    const far = Date.now() + 10 * LEAVING_GRACE_MS;
    expect(dropLeft(r.store, r.worktreeId, far, { locksDir: locksDir(r) })).toEqual([]);
    await stopping;
  });

  it("is kept by the stopping hook's own delivery", async () => {
    const r = await waitingSubagent();
    const stopping = runHook("stop", recorded("subagent-stop", r.root), deps());
    await until(() => marked(r) !== undefined, 5_000);
    const delivery = createDelivery(r.store, { status: fixedStatus() });
    await delivery.onToolBoundary(r.consumer(SUBAGENT), { stop: true });
    expect(marked(r)).not.toBeUndefined();
    await stopping;
  });

  it("leaves a consumer that was never marked to the other rules", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    await runHook("session-start", recorded("subagent-start", r.root), deps());
    const far = Date.now() + 10 * LEAVING_GRACE_MS;
    expect(dropLeft(r.store, r.worktreeId, far, { locksDir: locksDir(r) })).toEqual([]);
    expect(r.store.consumers.get(r.consumer(SUBAGENT))).not.toBeNull();
  });
});
