import { describe, expect, test } from "vitest";
import type { ProcessOwner } from "../../src/core/ps/model.js";
import { attribute, hostOf } from "../../src/core/ps/processes.js";
import { render } from "../../src/core/ps/render.js";
import { type FakeProcess, fakeSource, tableOf } from "./fixture-samples.js";
import {
  EXAMPLE_AT,
  exampleDaemon,
  exampleRepository,
  exampleSnapshot,
} from "./fixture-snapshot.js";

/*
 * Spec 021 D17 (row 021-14): `squeal ps` lists a daemon's runner hosts
 * under it, a local `squeal runner-host` and, for a remote one, the user's
 * `ssh` that reaches it with its target. A host is no test process: its
 * workers, which carry the daemon's mark, still are.
 */

const TOKEN = "6500d1d2-7ae8-4039-a08e-1b231205f5c8";
const DAEMON = 2091490;
const daemon: FakeProcess = { pid: DAEMON, ppid: 1049, comm: "MainThread" };
const owner: ProcessOwner = { pid: DAEMON, token: TOKEN, tiers: [] };
const local: FakeProcess = {
  pid: 2091500,
  ppid: DAEMON,
  cmdline: [
    "/usr/bin/node",
    "/plugin/dist/cli/squeal.mjs",
    "runner-host",
    "/repo",
    "--runner",
    "vitest",
  ],
};
const remote: FakeProcess = {
  pid: 2091510,
  ppid: DAEMON,
  cmdline: [
    "ssh",
    "-T",
    "-o",
    "BatchMode=yes",
    "build-box",
    "exec node --disable-warning=ExperimentalWarning .cache/squeal/0.1.1/cli/squeal.mjs runner-host .cache/squeal/trees/ab/root --runner vitest --tree",
  ],
};
const worker: FakeProcess = {
  pid: 2091520,
  ppid: 2091500,
  cmdline: ["/usr/bin/node", "/repo/node_modules/vitest/dist/workers/forks.js"],
  mark: `${TOKEN}:vitest`,
};

describe("a daemon's runner hosts (spec 021 D17)", () => {
  test("are its hosts, local and remote with the target, and a host's workers stay its test processes", () => {
    const processes = [daemon, local, remote, worker];
    const { source } = fakeSource(processes, { readsMarks: true });
    const found = attribute(source, tableOf(processes), [owner]);
    expect(found.hosts).toEqual([
      { pid: 2091500, daemonPid: DAEMON, runner: "vitest", target: null },
      { pid: 2091510, daemonPid: DAEMON, runner: "vitest", target: "build-box" },
    ]);
    expect(found.processes.map((p) => p.pid)).toEqual([2091520]);
  });

  test("reads no other command line as a host", () => {
    expect(hostOf(["ssh", "build-box", "uptime"])).toBeNull();
    expect(hostOf(["/usr/bin/node", "/x/forks.js"])).toBeNull();
    expect(hostOf(["/usr/bin/node", "cli.mjs", "runner-host", "/r", "--runner", "pytest"])).toEqual(
      { runner: "pytest", target: null },
    );
  });

  test("print one line each under their daemon", () => {
    const host = {
      startedAt: EXAMPLE_AT - 60_000,
      cpuPct: 1.5,
      cpuMs: 1_000,
      privateBytes: 40 * 2 ** 20,
      swapBytes: 0,
    };
    const d = exampleDaemon({
      processes: [],
      hosts: [
        { pid: 2091500, runner: "vitest", target: null, ...host },
        { pid: 2091510, runner: "vitest", target: "build-box", ...host },
      ],
    });
    const text = render(
      exampleSnapshot({ repositories: [exampleRepository("/repo/.git", true, [d])] }),
      { full: false },
    );
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.includes(String(d.pid)));
    expect(lines[at + 1]).toMatch(/^ {4}host vitest +2091500 +local /);
    expect(lines[at + 2]).toMatch(/^ {4}host vitest +2091510 +remote build-box \(ssh\) /);
  });
});
