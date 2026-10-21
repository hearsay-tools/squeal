import { chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { psCommand } from "../../src/cli/ps.js";
import type { PsSnapshot } from "../../src/core/ps/shape.js";
import type { FixtureProcess } from "./fixture.js";
import { oldDir } from "./fixture-host-rules.js";
import { fakeWindow, type SnapshotHost, snapshotHost } from "./fixture-snapshot.js";
import { writeProcesses } from "./fixture-stores.js";

/*
 * `reviews/wave-4.md` B2 through the command: a directory `leftover-temp`
 * cannot tell unused is no flag and no line of `--leftovers`, and an empty
 * `--leftovers` says why on stderr. The Linux source reads a fixture
 * `/proc`, where a process whose fd directory has mode 000 reads as one
 * whose open files cannot be read.
 */

const isRoot = process.getuid?.() === 0;
let host: SnapshotHost;
let leftover: string;

beforeEach(() => {
  host = snapshotHost();
  leftover = oldDir(
    join(host.places.tempDir, `squeal-${host.places.uid}`, "tmp", "00000000000000aa"),
  );
  writeProcesses(host, [plain(700, "bash"), plain(701, "gpg-agent")]);
});

afterEach(() => {
  vi.restoreAllMocks();
  chmodSync(join(host.base, "proc", "701", "fd"), 0o755);
  rmSync(host.base, { recursive: true, force: true });
});

function plain(pid: number, comm: string): FixtureProcess {
  return { pid, ppid: 1, pgid: pid, comm, nice: 0, ageS: 600, lifeCpuPct: 1, cmdline: [comm] };
}

async function ps(args: readonly string[]) {
  const window = fakeWindow();
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
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
  return { code, stdout, stderr };
}

describe("squeal ps when a process's open files cannot be read", () => {
  it("--leftovers lists a directory every process is read for, and says nothing on stderr", async () => {
    expect(await ps(["--leftovers"])).toEqual({ code: 0, stdout: `${leftover}\n`, stderr: "" });
  });

  it.skipIf(isRoot)(
    "--leftovers lists nothing and says why on stderr; --json has no flag and names the path in unknown",
    async () => {
      chmodSync(join(host.base, "proc", "701", "fd"), 0o000);
      const why = `1 directory under ${host.places.tempDir} that no readable process uses is not listed, since 1 process cannot be read: 701 gpg-agent`;
      expect(await ps(["--leftovers"])).toEqual({
        code: 0,
        stdout: "",
        stderr: `squeal ps --leftovers: ${why}\n`,
      });
      const shape = JSON.parse((await ps(["--json"])).stdout) as PsSnapshot;
      expect(shape.files.map((f) => f.flag)).not.toContain("leftover-temp");
      expect(shape.unknown).toContainEqual({ what: "flag leftover-temp", why, paths: [leftover] });
    },
  );
});
