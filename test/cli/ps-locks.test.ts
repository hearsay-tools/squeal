import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { type PsCommandOptions, psCommand } from "../../src/cli/ps.js";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { codeStoreOf, PS_LOCKS_VERSION, type PsLocks } from "../../src/core/ps/locks.js";
import { outsideGit } from "../harness/bundle-helpers.js";
import { fakeWindow, type SnapshotHost, snapshotHost } from "../ps/fixture-snapshot.js";
import { type FixtureRepo, HOME, makeRepo, NODE, writeProcesses } from "../ps/fixture-stores.js";

/*
 * Spec 021 D5 (row 021-10): `squeal ps --locks [--repo] [--json]` over a
 * fixture host. `/proc/locks` holds byte 120 of alpha's `store.sqlite-shm`
 * for alpha's daemon, and a hook waits behind it. Every database open is
 * counted, so a test sees that `--locks` opens none.
 */

const opened = vi.hoisted(() => [] as string[]);

vi.mock("node:sqlite", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:sqlite")>();
  class DatabaseSync extends real.DatabaseSync {
    constructor(...args: ConstructorParameters<typeof real.DatabaseSync>) {
      opened.push(String(args[0]));
      super(...args);
    }
  }
  return { ...real, DatabaseSync };
});

const HOOK_PID = 900;
const HOOK = `${HOME}/.claude/plugins/cache/hearsay/squeal/0.1.432/dist/hooks/post-tool-batch.mjs`;

let host: SnapshotHost;
let alpha: FixtureRepo;
let beta: FixtureRepo;

beforeEach(() => {
  host = snapshotHost();
  alpha = makeRepo(host.base, "alpha");
  beta = makeRepo(host.base, "beta");
  host.serve(800, alpha);
  host.serve(810, beta);
  // The fixture's stores were written and closed, which removes `-shm`; a live store has one.
  for (const repo of [alpha, beta]) writeFileSync(`${repo.storePath}-shm`, "");
  writeProcesses(host, [
    {
      pid: HOOK_PID,
      ppid: 1,
      pgid: HOOK_PID,
      comm: "node",
      nice: 0,
      ageS: 2,
      lifeCpuPct: 50,
      cmdline: [NODE, "--disable-warning=ExperimentalWarning", HOOK],
    },
  ]);
});

afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

/** `/proc/locks` lines on byte 120 of `repo`'s store `-shm`: held by `pid`, and each of `waiters` behind it. */
function holdStore(repo: FixtureRepo, pid: number, waiters: readonly number[] = []): void {
  const key = host.source.fileKey(`${repo.storePath}-shm`);
  const lines = [
    `91: POSIX  ADVISORY  WRITE ${pid} ${key} 120 120`,
    ...waiters.map((w) => `91: -> POSIX  ADVISORY  WRITE ${w} ${key} 120 120`),
    `92: POSIX  ADVISORY  READ ${pid} ${key} 128 128`,
  ];
  appendFileSync(join(host.base, "proc", "locks"), `${lines.join("\n")}\n`);
}

async function ps(args: string[], o: { cwd?: string; options?: PsCommandOptions } = {}) {
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
    now: fakeWindow().now,
    env: { HOME: host.places.home, XDG_RUNTIME_DIR: host.places.runtimeDir ?? "" },
  };
  opened.length = 0;
  const code = await psCommand(args, io, {
    platform: "linux",
    sourceFor: () => host.source,
    wait: () => Promise.reject(new Error("--locks takes no window")),
    tempDir: host.places.tempDir,
    uid: host.places.uid,
    ...o.options,
  });
  return { code, stdout, stderr, opened: [...opened] };
}

describe("squeal ps --locks", () => {
  test("names the holder and the waiter of each store, this repository first, and opens no database", async () => {
    writeFileSync(codeStorePath(alpha.commonDir), "");
    holdStore(alpha, 800, [HOOK_PID]);
    // The count sees opens: the fixture opened each store to write it.
    expect(opened).toContain(alpha.storePath);

    const out = await ps(["--locks"]);

    expect(out).toMatchObject({ code: 0, stderr: "", opened: [] });
    expect(out.stdout).toBe(
      [
        "Write locks of each Squeal store, from /proc/locks:",
        "",
        `${alpha.commonDir}/squeal (this repository)`,
        `  store.sqlite  held by pid 800 (node squeal.mjs daemon ${alpha.root})`,
        "                pid 900 waits (node --disable-warning=ExperimentalWarning post-tool-batch.mjs)",
        "  code.sqlite   not held",
        `${beta.commonDir}/squeal`,
        "  store.sqlite  not held",
        "  code.sqlite   no file",
        "",
      ].join("\n"),
    );
  });

  test("says plainly when no process holds or waits for any write lock", async () => {
    const out = await ps(["--locks"]);

    expect(out.code).toBe(0);
    expect(out.stdout).toContain(`${beta.commonDir}/squeal\n  store.sqlite  not held\n`);
    expect(out.stdout.endsWith("\nNo process holds or waits for a store's write lock.\n")).toBe(
      true,
    );
  });

  test("--repo lists this repository only", async () => {
    holdStore(beta, 810);

    const out = await ps(["--locks", "--repo"], { cwd: beta.root });

    expect(out.code).toBe(0);
    expect(out.stdout).toContain(
      `${beta.commonDir}/squeal (this repository)\n  store.sqlite  held by pid 810 `,
    );
    expect(out.stdout).not.toContain(alpha.commonDir);
  });

  test("--json gives the versioned shape", async () => {
    holdStore(alpha, 800, [HOOK_PID]);

    const out = await ps(["--locks", "--json"]);
    const locks = JSON.parse(out.stdout) as PsLocks;

    expect(out.code).toBe(0);
    expect(locks.version).toBe(PS_LOCKS_VERSION);
    expect(locks.repositories.map((r) => [r.commonDir, r.current])).toEqual([
      [alpha.commonDir, true],
      [beta.commonDir, false],
    ]);
    expect(locks.repositories[0]?.store).toEqual({
      path: alpha.storePath,
      exists: true,
      holders: [
        { pid: 800, command: `node squeal.mjs daemon ${alpha.root}`, waiting: false },
        {
          pid: HOOK_PID,
          command: "node --disable-warning=ExperimentalWarning post-tool-batch.mjs",
          waiting: true,
        },
      ],
    });
  });

  test("an unreadable /proc/locks makes each holder unknown", async () => {
    rmSync(join(host.base, "proc", "locks"));

    const out = await ps(["--locks", "--repo"]);

    expect(out.code).toBe(0);
    expect(out.stdout).toContain("  store.sqlite  holders unknown: /proc/locks cannot be read\n");
    expect(out.stdout).not.toContain("No process holds");
  });

  test("outside a repository and with no daemon, it says there is no store to show", async () => {
    rmSync(join(host.base, "proc", "800"), { recursive: true });
    rmSync(join(host.base, "proc", "810"), { recursive: true });
    const dir = outsideGit();

    const out = await ps(["--locks"], { cwd: dir });

    expect(out).toMatchObject({ code: 0, stderr: "" });
    expect(out.stdout).toBe(
      `No Squeal store to show: no daemon of this user runs, and ${dir} is not inside a git repository.\n`,
    );
  });

  test("macOS has no /proc/locks: exit 3", async () => {
    const out = await ps(["--locks"], { options: { platform: "darwin" } });

    expect(out).toMatchObject({ code: 3, stdout: "" });
    expect(out.stderr).toBe(
      "squeal ps --locks: darwin has no /proc/locks; lock holders are read on Linux only\n",
    );
  });

  test("--full does not apply: exit 2", async () => {
    const out = await ps(["--locks", "--full"]);

    expect(out.code).toBe(2);
    expect(out.stderr).toContain("squeal ps: --full does not apply to --locks");
  });

  test("the code store it lists is the code store's own path", () => {
    expect(codeStoreOf(alpha.commonDir)).toBe(codeStorePath(alpha.commonDir));
  });
});
