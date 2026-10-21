import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { type PsCommandOptions, psCommand } from "../../src/cli/ps.js";
import type { Flag } from "../../src/core/ps/model.js";
import { PS_SHAPE_VERSION, type PsSnapshot } from "../../src/core/ps/shape.js";
import {
  fakeWindow,
  NOW,
  noFlags,
  type SnapshotHost,
  snapshotHost,
} from "../ps/fixture-snapshot.js";
import { type FixtureRepo, makeRepo } from "../ps/fixture-stores.js";

/*
 * Spec 014 D1 and goal 5 (task 014-11): `squeal ps [--repo] [--full]
 * [--json]` and `squeal ps --leftovers`, over a fixture host: every option,
 * and exit 0 without a flag, 1 with any, 2 on a usage error and 3 on a
 * platform it does not cover. The source, the wait and the flags are
 * injected, so no test reads this host or sleeps 2 s.
 */

let host: SnapshotHost;
let alpha: FixtureRepo;
let beta: FixtureRepo;

beforeEach(() => {
  host = snapshotHost();
  alpha = makeRepo(host.base, "alpha");
  beta = makeRepo(host.base, "beta");
  host.serve(800, alpha);
  host.serve(810, beta);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

const LEFTOVER = "/tmp/squeal-1000/tmp/0123456789abcdef";
/** One flag on beta's daemon, and a leftover. */
const oneFlag: Flag = (model) => ({
  ...noFlags(model),
  daemons: new Map([
    [810, [{ flag: "past-idle", reason: "unused for 2 h", command: "squeal stop /b" }]],
  ]),
  leftovers: [LEFTOVER, `${LEFTOVER}0`],
});

async function ps(args: string[], o: { cwd?: string; options?: PsCommandOptions } = {}) {
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
    cwd: o.cwd ?? alpha.root,
    now: window.now,
    env: { HOME: host.places.home, XDG_RUNTIME_DIR: host.places.runtimeDir ?? "" },
  };
  const code = await psCommand(args, io, {
    platform: "linux",
    sourceFor: () => host.source,
    wait: window.wait,
    tempDir: host.places.tempDir,
    uid: host.places.uid,
    // The fixture's bundles are not on disk, so the real flags would say `install-gone`.
    flag: noFlags,
    ...o.options,
  });
  return { code, stdout, stderr, waits: window.waits };
}

describe("squeal ps", () => {
  test("prints the D8 text of every daemon on the host, the current repository first; exit 0 without a flag", async () => {
    const { code, stdout, stderr, waits } = await ps([]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const lines = stdout.split("\n");
    expect(lines[0]).toBe("squeal ps · 2 daemons, 0 test processes · no flags");
    expect(lines[1]).toMatch(/^Host {4}load 43\.2 36\.6 38\.8 on 24 CPUs · /);
    expect(lines[2]).toMatch(/^Squeal {2}CPU 0\.0 CPUs /);
    const blocks = lines.filter((l) => l.startsWith(host.base));
    expect(blocks).toEqual([
      expect.stringMatching(new RegExp(`^${alpha.root} \\(this repository\\) · 1 daemon · `)),
      expect.stringMatching(new RegExp(`^${beta.root} · 1 daemon · `)),
    ]);
    // One window of 2 s.
    expect(waits).toEqual([2_000]);
  });

  test("exit 1 with any flag, which it prints with the command that would end it", async () => {
    const { code, stdout } = await ps([], { options: { flag: oneFlag } });
    expect(code).toBe(1);
    expect(stdout.split("\n")[0]).toBe(
      "squeal ps · 2 daemons, 0 test processes · 1 flag: past-idle",
    );
    expect(stdout).toContain("\n! serving ");
    expect(stdout).toContain("\n      past-idle: unused for 2 h\n      ends it: squeal stop /b\n");
  });

  test("--json prints the versioned shape and nothing else, with the same exit code", async () => {
    const { code, stdout } = await ps(["--json"], { options: { flag: oneFlag } });
    expect(code).toBe(1);
    const shape = JSON.parse(stdout) as PsSnapshot;
    expect(shape).toMatchObject({ v: PS_SHAPE_VERSION, at: NOW, sampleMs: 2_000, flags: 1 });
    expect(shape.repositories.map((r) => r.commonDir)).toEqual([alpha.commonDir, beta.commonDir]);
    expect(stdout.endsWith("}\n")).toBe(true);
    expect(stdout.split("\n")).toHaveLength(2);
  });

  test("--repo keeps this repository; the host totals stay", async () => {
    const { code, stdout } = await ps(["--repo", "--json"], { options: { flag: oneFlag } });
    const shape = JSON.parse(stdout) as PsSnapshot;
    expect(shape.repositories.map((r) => [r.commonDir, r.current])).toEqual([
      [alpha.commonDir, true],
    ]);
    expect(shape).toMatchObject({ flags: 0, squeal: { daemons: 1 } });
    expect(shape.host.load).toEqual([43.21, 36.57, 38.82]);
    // Beta's flag is not this repository's.
    expect(code).toBe(0);
  });

  test("--repo outside a repository is a usage error, exit 2", async () => {
    const outside = join(host.base, "nowhere");
    mkdirSync(outside);
    const { code, stdout, stderr } = await ps(["--repo"], { cwd: outside });
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain(`squeal ps --repo: ${outside} is not inside a git repository`);
  });

  test("runs outside a repository too, without --repo: every daemon, none of them current", async () => {
    const outside = join(host.base, "nowhere");
    mkdirSync(outside);
    const { code, stdout } = await ps(["--json"], { cwd: outside });
    expect(code).toBe(0);
    const shape = JSON.parse(stdout) as PsSnapshot;
    expect(shape.repositories.map((r) => r.current)).toEqual([false, false]);
  });

  test("--full adds the counts of the files that never get a flag, and each unknown", async () => {
    const flag: Flag = (model) => ({ ...noFlags(model), unflagged: [{ kind: "lock", count: 2 }] });
    const brief = await ps([], { options: { flag } });
    const full = await ps(["--full"], { options: { flag } });
    expect(brief.stdout).not.toContain("never get a flag");
    expect(full.stdout).toContain("\nFiles that never get a flag: lock 2\n");
    expect(full.stdout).toContain("\nUnknown\n  daemon 800 lastUsedAt: ");
    expect(brief.stdout).toContain("--full names each");
  });

  test("--leftovers prints each leftover path, one per line, and nothing else, without the CPU window", async () => {
    const { code, stdout, stderr, waits } = await ps(["--leftovers"], {
      options: { flag: oneFlag },
    });
    expect([code, stderr]).toEqual([0, ""]);
    expect(stdout).toBe(`${LEFTOVER}\n${LEFTOVER}0\n`);
    expect(waits).toEqual([0]);
  });

  test.each([
    [["--watch"], 'unknown option "--watch"'],
    [["--leftovers", "--json"], "--leftovers prints the leftover paths and nothing else"],
    [["--repo", "--leftovers"], "--leftovers prints the leftover paths and nothing else"],
    [["status"], 'unknown option "status"'],
  ])("%j is a usage error, exit 2", async (args, problem) => {
    const { code, stdout, stderr, waits } = await ps(args);
    expect([code, stdout, waits]).toEqual([2, "", []]);
    expect(stderr).toContain(`squeal ps: ${problem}`);
    expect(stderr).toContain("usage: squeal ps [--repo] [--full] [--json]");
  });

  test("a platform other than Linux and macOS prints one line and exits 3", async () => {
    const { code, stdout, stderr, waits } = await ps(["--json"], {
      options: { platform: "win32", sourceFor: (p) => (p === "linux" ? host.source : null) },
    });
    expect([code, stdout, waits]).toEqual([3, "", []]);
    expect(stderr).toBe("squeal ps: win32 is not covered; squeal ps runs on Linux and macOS\n");
  });

  test("the platforms it covers are its own: win32 and aix have no source, exit 3", async () => {
    for (const platform of ["win32", "aix"] as const) {
      let stderr = "";
      const io: CliIo = {
        stdout: () => {},
        stderr: (t) => {
          stderr += t;
        },
        env: {},
      };
      expect(await psCommand([], io, { platform })).toBe(3);
      expect(stderr).toBe(
        `squeal ps: ${platform} is not covered; squeal ps runs on Linux and macOS\n`,
      );
    }
  });

  test("a snapshot that fails has no answer: its error on stderr, exit 3, never 1", async () => {
    const broken = {
      ...host.source,
      processTable: () => {
        throw new Error("the process table cannot be read");
      },
    };
    const { code, stdout, stderr } = await ps([], { options: { sourceFor: () => broken } });
    expect([code, stdout]).toEqual([3, ""]);
    expect(stderr).toBe("squeal ps: no snapshot: the process table cannot be read\n");
  });

  test("its places: the user config follows XDG_CONFIG_HOME, and no runtime dir without XDG_RUNTIME_DIR", async () => {
    const flag = vi.fn(noFlags);
    let stdout = "";
    const window = fakeWindow();
    const io: CliIo = {
      stdout: (t) => {
        stdout += t;
      },
      stderr: () => {},
      cwd: alpha.root,
      now: window.now,
      env: { HOME: host.places.home, XDG_CONFIG_HOME: join(host.base, "config") },
    };
    const options = {
      platform: "linux",
      sourceFor: () => host.source,
      wait: window.wait,
      flag,
    } as const;
    expect(
      await psCommand(["--json"], io, {
        ...options,
        tempDir: host.places.tempDir,
        uid: host.places.uid,
      }),
    ).toBe(0);
    expect(flag.mock.calls[0]?.[0].places).toEqual({
      uid: host.places.uid,
      home: host.places.home,
      userConfig: join(host.base, "config", "squeal", "config.json"),
      runtimeDir: null,
      tempDir: host.places.tempDir,
      commonDir: alpha.commonDir,
    });
    expect(JSON.parse(stdout)).toMatchObject({ v: PS_SHAPE_VERSION });
  });

  test("starts no daemon and writes no store: a repository without one has none after it", async () => {
    const gamma = makeRepo(host.base, "gamma");
    const runtime = readdirSync(host.places.runtimeDir ?? "");
    await ps([], { cwd: gamma.root });
    expect(existsSync(gamma.storePath)).toBe(false);
    expect(readdirSync(host.places.runtimeDir ?? "")).toEqual(runtime);
  });
});

describe("its main entry", () => {
  const io = () => {
    let stdout = "";
    return {
      io: {
        stdout: (t: string) => {
          stdout += t;
        },
        stderr: () => {},
        env: {},
      } satisfies CliIo,
      out: () => stdout,
    };
  };

  test("squeal ps --help prints both usages and exits 0 without a snapshot", async () => {
    const { io: cli, out } = io();
    expect(await main(["ps", "--help"], cli)).toBe(0);
    expect(out()).toContain("squeal ps [--repo] [--full] [--json]");
    expect(out()).toContain("squeal ps --leftovers");
    expect(out()).not.toContain("squeal stop");
  });

  test("squeal --help lists it", async () => {
    const { io: cli, out } = io();
    expect(await main(["--help"], cli)).toBe(0);
    expect(out()).toContain("  squeal ps [--repo] [--full] [--json]\n");
  });

  test("squeal ps with an unknown option exits 2 through main", async () => {
    const { io: cli } = io();
    expect(await main(["ps", "--nope"], cli)).toBe(2);
  });
});
