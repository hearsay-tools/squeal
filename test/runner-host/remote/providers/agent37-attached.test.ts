import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";
import type { HostedAdapter } from "../../../../src/core/runner-host/host.js";
import {
  type RemoteHost,
  type RemoteHostOptions,
  remoteHostOver,
  treeDir,
} from "../../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../../src/core/runner-host/remote/daemon-lane.js";
import type { RemoteLaneRunner } from "../../../../src/core/runner-host/remote/lane.js";
import { remoteSettingsPath } from "../../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../../src/core/runner-host/remote/tree-host.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { DEFAULT_POLICY, type Policy } from "../../../../src/core/types/policy.js";
import type { RunOptions } from "../../../../src/core/types/runner.js";
import { inProcessHost, POLICY, REPORT } from "../../fake-channel.js";
import { until } from "../lane-fixture.js";
import { fake, refOf, servedHosts, VERSION } from "../share-fixture.js";
import { fakeSshAt, mockAgent37Api } from "./agent37-api-mock.js";

/*
 * Review 0.1.619 B3 (spec 026 D8.4): a daemon's lane on an Agent37 machine
 * stays attached while the worktree commits and tags. Before each tier is
 * split, the lane asks the machine share, which reads the Git state here
 * and only when it moved brings the machine's `.git` to it over SSH; a
 * repository reader then reads the commit of now there. When that cannot
 * happen, the machine is no Git repository for the split: the reader runs
 * here. A local Agent37 API, a fake `ssh` whose instance is a directory
 * here, real Git, and remote hosts served in this process over the tree.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-attached-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const REF = refOf("vitest");
const GIT = { project: "", path: "test/git.test.ts" };
let n = 0;
const edit = (): RunOptions => ({
  runId: `r${++n}`,
  logDir: join(scratch, `logs${n}`),
  timeoutMs: 60_000,
  lane: "vitest",
});

/**
 * As `servedHosts`, but every host served here shares one tree host, as
 * hosts in one remote tree share its run directories: two in this one
 * process would otherwise remove each other's live run's (their names
 * carry this process's id). `kills` gets each host's end, in start order.
 */
function oneTreeHosts(
  root: string,
  remoteRoot: string,
  run: HostedAdapter["run"],
  kills: (() => void)[] = [],
): (options: RemoteHostOptions) => Promise<RemoteHost> {
  const tree = createTreeHost(remoteRoot, () => {});
  return async (options) => {
    const served = inProcessHost(async () => fake(options.runner, run), VERSION, { tree });
    kills.push(() => served.channel.kill());
    onTestFinished(() => served.channel.kill());
    return remoteHostOver(served.channel, "v-test", {
      target: options.target,
      version: VERSION,
      root,
      runner: options.runner,
      options: options.options,
      policy: options.policy,
    });
  };
}

async function attached(second = false) {
  const dir = join(scratch, `d${++n}`);
  const root = join(dir, "repo");
  for (const sub of ["src", "test"]) mkdirSync(join(root, sub), { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  writeFileSync(join(root, "test/git.test.ts"), "import '../src/a';\n");
  const real = realpathSync(root) as AbsolutePath;
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", real, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
      .toString()
      .trim();
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  const api = await mockAgent37Api();
  onTestFinished(() => api.close());
  const ssh = fakeSshAt(dir);
  const node = join(ssh.bin, "remote-node");
  // The instance's Node is this one, at the version the daemon asks for.
  writeFileSync(node, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} -v\n`, { mode: 0o755 });
  const places = { node, cache: ".squeal-remote" };
  const remoteRoot = join(ssh.home, treeDir(places, real), "root");
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "local-home"),
    PATH: `${ssh.bin}:${process.env.PATH}`,
    AGENT37_API_KEY: "sk_test_attached_5e3",
  };
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        [real]: {
          provider: "agent37",
          providerConfig: { ...places, apiBaseUrl: api.url },
          lanes: ["edit", "background"],
        },
      },
    }),
  );
  /** Each remote run: its files, and the commit and tags its tree's `.git` held then. */
  const remoteRuns: { files: string; head: string; tags: string }[] = [];
  /** Each served host's end, in the order the lanes started them. */
  const kills: (() => void)[] = [];
  /** Each remote run's files and the commit its tree's `.git` held as it ended. */
  const ends: { files: string; head: string }[] = [];
  let hold: Promise<void> | null = null;
  const localRuns: string[] = [];
  const logs: string[] = [];
  const notes: [string, string][] = [];
  const policy: Policy = {
    ...DEFAULT_POLICY,
    remote: { ...DEFAULT_POLICY.remote, needsRepository: ["test/git.*"] },
  };
  const there = (...args: string[]) =>
    execFileSync("git", ["-C", remoteRoot, ...args])
      .toString()
      .trim();
  const run: HostedAdapter["run"] = async (files) => {
    const names = files.map((f) => f.path).join(",");
    remoteRuns.push({ files: names, head: there("rev-parse", "HEAD"), tags: there("tag") });
    if (hold !== null) await hold;
    ends.push({ files: names, head: there("rev-parse", "HEAD") });
    return { ...REPORT, completedFiles: [...files] };
  };
  const remote = createDaemonRemote({
    root: real,
    commonDir: join(real, ".git") as AbsolutePath,
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => policy,
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: (line) => logs.push(line),
    env,
    startHost: second
      ? oneTreeHosts(real, remoteRoot, run, kills)
      : servedHosts(real, remoteRoot, () => run),
  }) as DaemonRemote;
  const here = fake("vitest", async (files) => {
    localRuns.push(files.map((f) => f.path).join(","));
    return { ...REPORT, completedFiles: [...files] };
  });
  const lane = remote.wrap({
    runner: "vitest",
    local: here,
    tiers: ["edit", "background"],
    start: { options: { childEnv: {} }, policy: () => POLICY },
  }) as unknown as RemoteLaneRunner;
  // Review 0.1.619-r2 N1: a second lane on the same machine, as a slow lane's would be.
  const other = second
    ? (remote.wrap({
        runner: "vitest",
        name: "vitest other",
        local: here,
        tiers: ["edit", "background"],
        start: { options: { childEnv: {} }, policy: () => POLICY },
      }) as unknown as RemoteLaneRunner)
    : null;
  onTestFinished(async () => {
    await Promise.all([lane.close(), other?.close()]);
    await remote.release();
  });
  const goes = (topic: string) => / go there/.test(notes.findLast(([t]) => t === topic)?.[1] ?? "");
  await until(() => goes("remote-lane") && (other === null || goes("remote-lane:vitest other")));
  const fakeSsh = join(ssh.bin, "ssh");
  const working = readFileSync(fakeSsh, "utf8");
  return {
    lane,
    other,
    git,
    there,
    remoteRuns,
    ends,
    /** Remote runs wait from now until the returned call. */
    hold: () => {
      let release = () => {};
      hold = new Promise((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
    localRuns,
    logs,
    kills,
    sshCalls: () => ssh.argv().length,
    /** Every SSH command fails from now, as an unreachable instance's would. */
    breakSsh: () => writeFileSync(fakeSsh, "#!/bin/sh\nexit 255\n", { mode: 0o755 }),
    mendSsh: () => writeFileSync(fakeSsh, working, { mode: 0o755 }),
    release: () => remote.release(),
  };
}

describe("an attached Agent37 lane and the worktree's Git state (review 0.1.619 B3)", () => {
  it("brings a new commit and tag there before the next split, with no SSH while unchanged", async () => {
    const a = await attached();
    await a.lane.run([REF, GIT], edit());
    expect(a.remoteRuns.at(-1)).toEqual({
      files: `${REF.path},${GIT.path}`,
      head: a.git("rev-parse", "HEAD"),
      tags: "",
    });
    const calls = a.sshCalls();
    await a.lane.run([REF, GIT], edit());
    expect(a.sshCalls()).toBe(calls);
    a.git("commit", "-q", "--allow-empty", "-m", "second");
    a.git("tag", "v2");
    await a.lane.run([REF, GIT], edit());
    expect(a.remoteRuns.at(-1)).toEqual({
      files: `${REF.path},${GIT.path}`,
      head: a.git("rev-parse", "HEAD"),
      tags: "v2",
    });
    expect(a.localRuns).toEqual([]);
  });

  it("runs the repository's readers here while the machine's .git cannot be brought current", async () => {
    const a = await attached();
    const first = a.git("rev-parse", "HEAD");
    a.breakSsh();
    a.git("commit", "-q", "--allow-empty", "-m", "second");
    await a.lane.run([REF, GIT], edit());
    expect(a.localRuns).toEqual([GIT.path]);
    expect(a.remoteRuns.at(-1)).toEqual({ files: REF.path, head: first, tags: "" });
    expect(a.logs).toContainEqual(expect.stringMatching(/git history not brought current/));
    // Reachable again: the next split brings it current, and the reader goes there.
    a.mendSsh();
    await a.lane.run([REF, GIT], edit());
    expect(a.remoteRuns.at(-1)).toEqual({
      files: `${REF.path},${GIT.path}`,
      head: a.git("rev-parse", "HEAD"),
      tags: "",
    });
    expect(a.localRuns).toEqual([GIT.path]);
  });

  it("reaches the machine no more once the daemon's exit began, and keeps the readers here", async () => {
    const a = await attached();
    await a.release();
    const calls = a.sshCalls();
    a.git("tag", "v3");
    await a.lane.run([REF, GIT], edit());
    expect(a.sshCalls()).toBe(calls);
    expect(a.localRuns).toEqual([GIT.path]);
  });
});

describe("two lanes on one Agent37 machine and its Git state (review 0.1.619-r2 N1)", () => {
  it("keeps a run's .git stable on one lane while another lane's refresh waits for it", async () => {
    const a = await attached(true);
    const first = a.git("rev-parse", "HEAD");
    const release = a.hold();
    const running = a.lane.run([REF, GIT], edit());
    await until(() => a.remoteRuns.length === 1);
    a.git("commit", "-q", "--allow-empty", "-m", "second");
    a.git("tag", "v2");
    const second = a.git("rev-parse", "HEAD");
    // The other lane sees the commit: its split asks for a refresh, which must wait.
    const other = a.other?.run([REF, GIT], edit());
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline && a.remoteRuns.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(a.remoteRuns).toHaveLength(1);
    expect(a.there("rev-parse", "HEAD")).toBe(first);
    expect(a.there("tag")).toBe("");
    release();
    await Promise.all([running, other]);
    // The held run ended on the Git state it started on; the other then ran on the new one.
    expect(a.ends[0]).toEqual({ files: `${REF.path},${GIT.path}`, head: first });
    expect(a.remoteRuns[1]).toEqual({ files: `${REF.path},${GIT.path}`, head: second, tags: "v2" });
    expect(a.localRuns).toEqual([]);
  });

  it("wakes the machine for a lane that lost it only once the other lane's run left", async () => {
    // Review 0.1.620 N1. The clock moves past a lost lane's first reconnect backoff (30 s).
    const real = Date.now.bind(Date);
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => real() + skew);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const a = await attached(true);
    const first = a.git("rev-parse", "HEAD");
    const release = a.hold();
    const running = a.lane.run([REF, GIT], edit());
    await until(() => a.remoteRuns.length === 1);
    // The other lane's host ends: its next run finds it gone, and the machine counts as lost.
    a.kills[1]?.();
    await a.other?.run([REF], edit());
    a.git("commit", "-q", "--allow-empty", "-m", "second");
    const second = a.git("rev-parse", "HEAD");
    skew += 31_000;
    // Its next run reconnects it: the wake that brings `.git` current must wait for the held run.
    const reconnecting = a.other?.run([REF], edit());
    const deadline = real() + 1_500;
    while (real() < deadline && a.there("rev-parse", "HEAD") === first) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(a.there("rev-parse", "HEAD")).toBe(first);
    release();
    await Promise.all([running, reconnecting]);
    expect(a.ends[0]).toEqual({ files: `${REF.path},${GIT.path}`, head: first });
    // Then the wake brought it there.
    await until(() => a.there("rev-parse", "HEAD") === second);
  });

  it("lets runs on two lanes share the machine at once while its Git state stands", async () => {
    const a = await attached(true);
    const release = a.hold();
    const both = Promise.all([a.lane.run([REF], edit()), a.other?.run([GIT], edit())]);
    // Neither waits for the other: both are on the machine together.
    await until(() => a.remoteRuns.length === 2);
    release();
    await both;
    expect(a.ends).toHaveLength(2);
  });
});
