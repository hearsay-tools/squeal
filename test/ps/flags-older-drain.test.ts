import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { psCommand } from "../../src/cli/ps.js";
import { departedMetaKey } from "../../src/core/delivery/expiry.js";
import type { PsSnapshot } from "../../src/core/ps/shape.js";
import { worktreeMetaKey } from "../../src/core/types/index.js";
import { BOOT_SECONDS, UPTIME_SECONDS } from "./fixture.js";
import { claudeInstalled, installScript } from "./fixture-model.js";
import { fakeWindow, NOW, type SnapshotHost, snapshotHost } from "./fixture-snapshot.js";
import { daemonProcess, daemonRecord, type FixtureRepo, makeRepo } from "./fixture-stores.js";

/*
 * Task 014-38 through the command: a daemon older than its harness installs
 * that drains its slow work names `older` in its state, has no flag and
 * exits 0; at the drain's deadline the flag returns with `squeal stop`
 * (spec 014 D7, the third information state).
 */

const MINUTE = 60_000;
const AGE_S = 2 * 3600;

let host: SnapshotHost;
let alpha: FixtureRepo;

beforeEach(() => {
  host = snapshotHost();
  alpha = makeRepo(host.base, "alpha");
  claudeInstalled(host.places.home, "0.1.235");
});

afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

/** Daemon 800 of 0.1.234, up 2 h, whose last session left `agoMs` ago and whose slow work waits. */
function drains(agoMs: number): void {
  const script = installScript(host.places.home, "claude", "0.1.234");
  const startedAt = (BOOT_SECONDS + UPTIME_SECONDS - AGE_S + 5) * 1000;
  host.serve(800, alpha, {
    record: daemonRecord(alpha, { startedAt, heartbeatAt: NOW, squealVersion: "0.1.234" }),
    fill: (store) => {
      store.meta.set(departedMetaKey(alpha.id), String(NOW - agoMs));
      store.meta.set(
        worktreeMetaKey("slowTier", alpha.id),
        JSON.stringify({ kind: "waiting", for: "fast" }),
      );
    },
    process: daemonProcess({
      pid: 800,
      root: alpha.root,
      lockPath: alpha.lockPath,
      script,
      ageS: AGE_S,
    }),
  });
}

async function ps(args: readonly string[]) {
  const window = fakeWindow();
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd: host.base,
    now: window.now,
    env: { HOME: host.places.home, XDG_RUNTIME_DIR: host.places.runtimeDir ?? "" },
  };
  const code = await psCommand(args, io, {
    platform: "linux",
    sourceFor: () => host.source,
    wait: window.wait,
    tempDir: host.places.tempDir,
    uid: host.places.uid,
  });
  return { code, stdout };
}

const daemonOf = (stdout: string) => (JSON.parse(stdout) as PsSnapshot).repositories[0]?.daemons[0];

describe("squeal ps on an older daemon that drains", () => {
  it("names older in its draining state, flags nothing and exits 0", async () => {
    drains(42 * MINUTE);
    const text = await ps([]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("draining 18m left, older");
    expect(text.stdout).not.toContain("ends it");
    const json = await ps(["--json"]);
    expect(json.code).toBe(0);
    expect(daemonOf(json.stdout)).toMatchObject({
      phase: "serving",
      state: "draining 18m left, older",
      flags: [],
      work: { drainLeftMs: 18 * MINUTE },
    });
  });

  it("flags older with squeal stop at the drain's deadline, and exits 1", async () => {
    drains(60 * MINUTE);
    const json = await ps(["--json"]);
    expect(json.code).toBe(1);
    expect(daemonOf(json.stdout)).toMatchObject({
      state: "serving",
      flags: [
        {
          flag: "older",
          reason: "version 0.1.234; claude installs 0.1.235",
          command: `squeal stop ${alpha.root}`,
        },
      ],
    });
    const text = await ps([]);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain(`ends it: squeal stop ${alpha.root}`);
  });
});
