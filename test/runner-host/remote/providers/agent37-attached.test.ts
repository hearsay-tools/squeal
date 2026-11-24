import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { treeDir } from "../../../../src/core/runner-host/remote/connect.js";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../../src/core/runner-host/remote/daemon-lane.js";
import type { RemoteLaneRunner } from "../../../../src/core/runner-host/remote/lane.js";
import { remoteSettingsPath } from "../../../../src/core/runner-host/remote/settings.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { DEFAULT_POLICY, type Policy } from "../../../../src/core/types/policy.js";
import type { RunOptions } from "../../../../src/core/types/runner.js";
import { POLICY, REPORT } from "../../fake-channel.js";
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

async function attached() {
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
    startHost: servedHosts(real, remoteRoot, () => async (files) => {
      remoteRuns.push({
        files: files.map((f) => f.path).join(","),
        head: there("rev-parse", "HEAD"),
        tags: there("tag"),
      });
      return { ...REPORT, completedFiles: [...files] };
    }),
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
  onTestFinished(async () => {
    await lane.close();
    await remote.release();
  });
  await until(() => / go there/.test(notes.findLast(([t]) => t === "remote-lane")?.[1] ?? ""));
  const fakeSsh = join(ssh.bin, "ssh");
  const working = readFileSync(fakeSsh, "utf8");
  return {
    lane,
    git,
    remoteRuns,
    localRuns,
    logs,
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
