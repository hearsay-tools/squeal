import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";
import type { SshTarget } from "../../../src/core/runner-host/remote/ssh.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";

/*
 * Row 026-30: the daemon's exit (`beginExit`) ends a machine's Git work
 * that has not started. `exitSignal` aborts then, a refresh asked after it
 * reaches nothing, and one waiting for a run's Git lease is refused at
 * once, so the exit no longer waits on a run that waits on the exit. Work
 * already writing `.git` still ends before `release`, as review 0.1.623 B1
 * asks.
 */

/** What the fake machine's `.git` sync saw: `null` a read, else a write over ssh. */
const syncs: (SshTarget | null)[] = [];
let writing: Promise<void> = Promise.resolve();
let released = 0;

vi.mock("../../../src/core/runner-host/remote/providers/index.js", () => ({
  providerOf: () => ({
    kind: "fake-git",
    validate: () => null,
    acquire: async () => ({
      id: "fake-1",
      provider: "fake-git",
      ssh: { destination: "box", ssh: "/bin/false" },
      places: { node: "node", cache: ".cache" },
      capabilities: { hasGitRepository: true, sleepOnIdle: false, ephemeralHostKey: false },
      wake: async () => {},
      sleep: async () => {},
      release: async () => {
        released++;
      },
      gitCurrent: () => false,
      syncGit: async (ssh: SshTarget | null) => {
        syncs.push(ssh);
        if (ssh !== null) await writing;
        return false;
      },
    }),
    reattach: async () => null,
  }),
  PROVIDER_KINDS: ["fake-git"],
}));

const { MachineEnding, shareMachine } = await import(
  "../../../src/core/runner-host/remote/machine-share.js"
);

const scratch = mkdtempSync(join(tmpdir(), "squeal-share-exit-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function reached() {
  syncs.length = 0;
  released = 0;
  writing = Promise.resolve();
  const dir = mkdtempSync(join(scratch, "w-"));
  const env = { XDG_STATE_HOME: join(dir, "state"), HOME: dir, PATH: process.env.PATH };
  const share = shareMachine({
    lane: {
      provider: "fake-git",
      providerConfig: {},
      runners: ["vitest"],
      lanes: ["background"],
      planning: "local",
      coverage: "off",
      environmentMode: "match-local",
      diskCheck: { enabled: false, maxWriteMs: 10, onSlowDisk: "warn" },
      whenLost: "not-run",
      node: "node",
      cache: ".cache",
    },
    request: {
      repositoryKey: dir,
      worktreeId: "w1",
      worktreeRoot: dir as AbsolutePath,
      commonDir: join(dir, ".git") as AbsolutePath,
      remoteUrls: [],
      nodeVersion: "v24.0.0",
      log: () => {},
      env,
    },
    env,
  });
  onTestFinished(() => share.release());
  await share.reach();
  return share;
}

describe("a machine's Git work at the daemon's exit (row 026-30)", () => {
  it("aborts exitSignal at beginExit, and a refresh after it reaches nothing", async () => {
    const share = await reached();
    expect(share.exitSignal.aborted).toBe(false);
    share.beginExit();
    expect(share.exitSignal.aborted).toBe(true);
    await share.refreshGit();
    expect(syncs).toEqual([]);
  });

  it("refuses at once a refresh waiting for a run's Git lease, and releases while the run holds it", async () => {
    const share = await reached();
    const end = await share.gitLease();
    const refreshing = share.refreshGit().then(
      () => "written",
      (error: unknown) => (error instanceof MachineEnding ? "refused" : String(error)),
    );
    // Read, found behind, and now waiting for the lease.
    await vi.waitFor(() => expect(syncs).toEqual([null]));
    await new Promise((done) => setTimeout(done, 30));
    share.beginExit();
    expect(await refreshing).toBe("refused");
    // Nothing wrote `.git`, and the exit does not wait for the run to end its lease.
    expect(syncs).toEqual([null]);
    await share.release();
    expect(released).toBe(1);
    end();
  });

  it("still lets a write in flight end before the machine is released", async () => {
    const share = await reached();
    let open = () => {};
    writing = new Promise((resolve) => {
      open = resolve;
    });
    const refreshing = share.refreshGit();
    await vi.waitFor(() => expect(syncs).toHaveLength(2));
    share.beginExit();
    const releasing = share.release();
    await new Promise((done) => setTimeout(done, 50));
    expect(released).toBe(0);
    open();
    await refreshing;
    await releasing;
    expect(released).toBe(1);
  });
});
