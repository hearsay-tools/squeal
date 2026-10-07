import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateDaemon } from "../../src/core/daemon/ensure.js";
import { socketPathFor, userTmpDir } from "../../src/core/daemon/paths.js";
import {
  childEnv,
  daemonSuite,
  type FixtureRepo,
  readNotes,
  SLOW,
  stopProcess,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

const suite = daemonSuite();
const { fixture, daemon } = suite;

const policyNotes = (repo: FixtureRepo) =>
  readNotes(repo).filter((text) => text.startsWith("squeal.config.json"));

const keys = (repo: FixtureRepo) =>
  withStore(repo, (store) =>
    Object.fromEntries(
      store.testFileKeys.list(repo.worktreeId).map((row) => [row.testFile.path, row.key]),
    ),
  );

describe("squeal daemon: a bad policy is a state (spec 001 D11, review S3)", SLOW, () => {
  it("probe H: bad keys give one note and a running daemon, across starts and a restart", async () => {
    const repo = fixture({
      "squeal.config.json": '{"stop": {"waitMs": "500"}, "runner": {"tierSzie": 2}}',
    });
    const first = daemon(repo);
    await waitReady(repo, first);
    // SessionStart and SubagentStart spawn again; those daemons lose the lock.
    for (let i = 0; i < 2; i++) {
      const again = daemon(repo);
      expect(await again.exited).toEqual({ code: 0, signal: null });
    }
    expect(first.child.exitCode).toBeNull();
    const expected = [
      'squeal.config.json: "stop.waitMs" must be a number >= 0, got "500"; unknown key "runner.tierSzie"; the defaults apply in their place',
    ];
    expect(policyNotes(repo)).toEqual(expected);

    await stopProcess(first);
    const second = daemon(repo);
    await waitReady(repo, second);
    expect(policyNotes(repo)).toEqual(expected);
  });

  it("an edit to squeal.config.json while it runs reloads the policy and re-keys", async () => {
    const repo = fixture({ "fixtures/data.json": '{"n": 1}\n' });
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const before = keys(repo);
    expect(Object.keys(before)).toHaveLength(5);

    writeFileSync(
      join(repo.root, "squeal.config.json"),
      '{"inputs": ["fixtures/**"], "stop": {"waitMs": "x"}}\n',
    );
    await waitFor(() => policyNotes(repo).length > 0, 30_000, "a reload note");
    expect(policyNotes(repo)).toEqual([
      'squeal.config.json changed; policy reloaded: "stop.waitMs" must be a number >= 0, got "x"; the defaults apply in their place',
    ]);
    const after = keys(repo);
    for (const [path, key] of Object.entries(before)) expect(after[path], path).not.toBe(key);

    // The declared input now moves keys.
    writeFileSync(join(repo.root, "fixtures/data.json"), '{"n": 2}\n');
    await waitFor(
      () => Object.entries(keys(repo)).every(([path, key]) => key !== after[path]),
      30_000,
      "keys moved by the declared input",
    );
    expect(spawned.child.exitCode).toBeNull();
  });
});

describe("squeal daemon: socket directory without XDG_RUNTIME_DIR (review S8)", SLOW, () => {
  /** A short private directory for a TMPDIR, removed after the test. */
  function shortTmp(): string {
    const tmp = realpathSync(mkdtempSync("/tmp/sq-"));
    suite.cleanup(() => rmSync(tmp, { recursive: true, force: true }));
    return tmp;
  }

  /** The fixture's environment without a runtime dir, with `TMPDIR` set. */
  function withoutRuntimeDir(repo: FixtureRepo, extra: NodeJS.ProcessEnv = {}): FixtureRepo {
    const env: NodeJS.ProcessEnv = { ...childEnv(repo.runtimeDir), TMPDIR: shortTmp(), ...extra };
    delete env.XDG_RUNTIME_DIR;
    return { ...repo, env, socketPath: socketPathFor(repo.worktreeId, env) };
  }

  it("binds in /tmp/squeal-<uid>, not under TMPDIR, and a hook with another TMPDIR reaches it", async () => {
    const repo = withoutRuntimeDir(fixture());
    expect(repo.socketPath).toBe(join(userTmpDir(), `squeal-${repo.worktreeId}.sock`));
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    expect(statSync(userTmpDir()).mode & 0o777).toBe(0o700);
    const record = withStore(repo, (store) => store.worktrees.get(repo.worktreeId));
    expect(record?.daemon?.socketPath).toBe(repo.socketPath);

    // No recorded socket to lean on: the hook finds the daemon by computing its path.
    const located = await locateDaemon(repo.root, 1_000, {
      env: { TMPDIR: shortTmp() },
      record: null,
    });
    expect(located).toMatchObject({ socketPath: repo.socketPath, probe: { state: "alive" } });
  });

  it("refuses a directory another user owns, with a note, and exits 1", async () => {
    // Another user is played by a uid the test does not have (as scratch-refused does).
    const uid = 3_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const dir = `/tmp/squeal-${uid}`;
    mkdirSync(dir, { mode: 0o700 });
    suite.cleanup(() => {
      for (const name of readdirSync("/tmp").filter((n) => n.startsWith(`squeal-${uid}`))) {
        rmSync(join("/tmp", name), { recursive: true, force: true });
      }
    });
    const preload = join(shortTmp(), "uid.mjs");
    writeFileSync(preload, `process.getuid = () => ${uid};\n`);
    const repo = withoutRuntimeDir(fixture(), { NODE_OPTIONS: `--import=${preload}` });
    const spawned = daemon(repo);
    expect(await spawned.exited).toEqual({ code: 1, signal: null });
    const reason = `could not start serving: socket directory ${dir} is owned by uid ${process.getuid?.()}, not ${uid}; refusing to use it`;
    expect(spawned.stderr()).toContain(reason);
    expect(readNotes(repo).at(-1)).toBe(reason);
    expect(
      withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon ?? null),
    ).toBeNull();
  });
});

describe("squeal daemon: signals (review N8)", SLOW, () => {
  /** Live child processes of `pid` running Vitest's worker pool. */
  function vitestWorkers(pid: number): number[] {
    let out = "";
    try {
      out = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    } catch {
      return [];
    }
    return out
      .split("\n")
      .filter((line) => line !== "")
      .map(Number)
      .filter((child) => alive(child) && cmdline(child).includes("vitest"));
  }

  function cmdline(pid: number): string {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      return "";
    }
  }

  /** Exists and is not a zombie waiting for its reaper. */
  function alive(pid: number): boolean {
    try {
      return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch {
      return false;
    }
  }

  it.runIf(process.platform === "linux")(
    "SIGTERM during a tier stops Vitest's worker pool under ownSignals",
    async () => {
      const repo = fixture({
        "test/slow.test.ts":
          'import { it } from "vitest";\nit("is slow", async () => {\n  await new Promise((done) => setTimeout(done, 3_000));\n});\n',
      });
      const spawned = daemon(repo);
      await waitReady(repo, spawned);
      const pid = spawned.child.pid ?? 0;
      const workers = await waitFor(
        () => {
          const found = vitestWorkers(pid);
          return found.length > 0 ? found : null;
        },
        60_000,
        "a Vitest worker process",
      );
      spawned.child.kill("SIGTERM");
      expect(await spawned.exited).toEqual({ code: 0, signal: null });
      expect(withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon)).toBeNull();
      await waitFor(() => workers.every((worker) => !alive(worker)), 10_000, "workers gone");
    },
  );
});
