import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rootStatOf } from "../../../src/cli/runner-host.js";
import {
  type DockerCli,
  execArgs,
  guarded,
  type ImageInfo,
  imageInspectArgs,
  type ManagedListing,
  parsePs,
  psArgs,
  type RunIdleSpec,
  rmArgs,
  runIdleArgs,
} from "../../../src/core/runner-host/container/docker.js";
import { startContainerHost } from "../../../src/core/runner-host/container/index.js";
import {
  type ContainerPaths,
  ensureContainer,
  type ManagedTarget,
  reapOrphanedContainers,
  verifyMount,
} from "../../../src/core/runner-host/container/manager.js";
import {
  checkImage,
  nodeAdmitted,
  parseNodeVersion,
  proveMount,
} from "../../../src/core/runner-host/container/preflight.js";
import { encodeLine, frameOf, type HostStarted } from "../../../src/core/runner-host/protocol.js";
import { fakeAdapter, inProcessHost, POLICY } from "../fake-channel.js";

/*
 * Spec 027 D4, D5 and D6 (row 027-05) without Docker: the arguments Squeal
 * gives it, the checks before a run, and what the manager asks a fake CLI.
 */

let dir: string;
let paths: ContainerPaths;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "squeal-ct-"));
  paths = {
    worktreeRoot: join(dir, "wt"),
    squealBundleDir: join(dir, "bundle"),
    worktreeCacheDir: join(dir, "cache"),
    worktreeLogRoot: join(dir, "logs"),
  };
  for (const path of Object.values(paths)) mkdirSync(path);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const IMAGE: ImageInfo = {
  id: "sha256:aaa",
  repoDigests: [],
  env: [],
  architecture: "amd64",
  os: "linux",
};
const TARGET: ManagedTarget = { name: "backend", image: "sb/backend", network: "sb_default" };

function spec(over: Partial<RunIdleSpec> = {}): RunIdleSpec {
  return {
    name: "squeal-ct-12345678-backend-abc",
    imageId: IMAGE.id,
    user: { uid: 1001, gid: 1001 },
    labels: { "org.squeal.managed": "true" },
    mounts: [{ source: paths.worktreeRoot, target: paths.worktreeRoot }],
    env: { HOME: "/tmp" },
    ...over,
  };
}

/** A fake CLI recording each call, its containers in `listed`. */
function fakeCli(over: Partial<DockerCli> & { node?: string; listed?: ManagedListing[] } = {}) {
  const calls: string[] = [];
  const runs: RunIdleSpec[] = [];
  const listed = over.listed ?? [];
  const cli: DockerCli = {
    imageInspect: async (image) => {
      calls.push(`inspect ${image}`);
      return IMAGE;
    },
    runIdle: async (s) => {
      calls.push(`run ${s.name}`);
      runIdleArgs(s);
      runs.push(s);
      return "c-new";
    },
    execSyncText: async (id, argv) => {
      calls.push(`exec ${id} ${argv.join(" ")}`);
      return over.node === undefined
        ? { code: 0, stdout: "22.19.0\n", stderr: "" }
        : over.node === "none"
          ? { code: 127, stdout: "", stderr: "exec: node: not found" }
          : { code: 0, stdout: `${over.node}\n`, stderr: "" };
    },
    spawnExec: (id, argv) => {
      calls.push(`spawn ${id} ${argv.join(" ")}`);
      throw new Error("no spawn in unit tests");
    },
    psManaged: async (filter) => {
      calls.push(`ps ${JSON.stringify(filter.labels ?? {})}`);
      return listed;
    },
    removeManaged: async (id) => {
      calls.push(`rm ${id}`);
      return true;
    },
    ...over,
  };
  return { cli, calls, runs };
}

describe("Docker arguments (D4)", () => {
  it("runs an idle container with --init, --pull never, --user and bind mounts only", () => {
    const args = runIdleArgs(
      spec({
        mounts: [
          { source: paths.worktreeRoot, target: paths.worktreeRoot },
          { source: paths.squealBundleDir, target: paths.squealBundleDir, readonly: true },
        ],
        network: "sb_default",
      }),
    );
    expect(args.slice(0, 1)).toEqual(["run"]);
    expect(args).toContain("--init");
    expect(args).toContain("--pull=never");
    expect(args).toContain("--user=1001:1001");
    expect(args).toContain("--network=sb_default");
    expect(args).toContain(
      `--mount=type=bind,source=${paths.worktreeRoot},target=${paths.worktreeRoot}`,
    );
    expect(args).toContain(
      `--mount=type=bind,source=${paths.squealBundleDir},target=${paths.squealBundleDir},readonly`,
    );
    expect(args.slice(-3)).toEqual(["--entrypoint=sleep", IMAGE.id, "infinity"]);
    for (const word of ["-v", "--volume", "--privileged", "build", "pull", "compose"]) {
      expect(args).not.toContain(word);
    }
  });

  it("refuses every forbidden command and flag among Docker's own options", () => {
    for (const bad of [
      "-v",
      "-v/x:/x",
      "--volume=/x:/x",
      "--privileged",
      "build",
      "pull",
      "compose",
    ]) {
      expect(() => guarded("run", ["--init", "--pull=never", "--user=1:1", bad], ["img"])).toThrow(
        /never runs docker/,
      );
    }
    expect(() => guarded("run", ["--mount=type=volume,source=v,target=/v"], [])).toThrow(/bind/);
    expect(() => guarded("run", ["--mount=source=v,type=bind,target=/v"], [])).toThrow(/bind/);
    expect(() =>
      guarded("run", ["--init", "--pull=never", "--pull=always", "--user=1:1"], ["img"]),
    ).toThrow(/--pull=always/);
    expect(() => guarded("run", ["--pull=never", "--user=1:1"], ["img"])).toThrow(/--init/);
    expect(() => guarded("run", ["--init", "--user=1:1"], ["img"])).toThrow(/--pull=never/);
    expect(() => guarded("run", ["--init", "--pull=never"], ["img"])).toThrow(/--user/);
  });

  it("leaves the command run inside a container unscanned", () => {
    expect(execArgs("c1", ["python", "-m", "pytest", "-v"])).toEqual([
      "exec",
      "--interactive",
      "c1",
      "python",
      "-m",
      "pytest",
      "-v",
    ]);
  });

  it("fails closed on a missing mount source before Docker sees it", () => {
    const missing = join(dir, "gone");
    expect(() => runIdleArgs(spec({ mounts: [{ source: missing, target: missing }] }))).toThrow(
      /no missing path/,
    );
    expect(() => runIdleArgs(spec({ mounts: [{ source: "relative", target: "/x" }] }))).toThrow(
      /no missing path/,
    );
  });

  it("refuses a path that would split the mount option", () => {
    const odd = join(dir, "a,b");
    mkdirSync(odd);
    expect(() => runIdleArgs(spec({ mounts: [{ source: odd, target: odd }] }))).toThrow(/holding/);
  });

  it("inspects, lists and removes with -- before the name, and only managed containers", () => {
    expect(imageInspectArgs("-x")).toEqual(["image", "inspect", "--format={{json .}}", "--", "-x"]);
    expect(rmArgs("c1")).toEqual(["rm", "--force", "--", "c1"]);
    const ps = psArgs({ labels: { "org.squeal.worktree": "w1" }, id: "c1" });
    expect(ps).toContain("--filter=label=org.squeal.managed=true");
    expect(ps).toContain("--filter=label=org.squeal.worktree=w1");
    expect(ps).toContain("--filter=id=c1");
    expect(parsePs("c1\tn1\trunning\tw1\tbackend\tsha256:a\t42\n\n")).toEqual([
      {
        id: "c1",
        name: "n1",
        state: "running",
        worktree: "w1",
        target: "backend",
        image: "sha256:a",
        pid: "42",
      },
    ]);
  });
});

describe("Node preflight (D5.2)", () => {
  it("admits 22.19.0 and later, refuses 22.18.9 and unparseable text", () => {
    expect(nodeAdmitted([22, 18, 9])).toBe(false);
    expect(nodeAdmitted([22, 19, 0])).toBe(true);
    expect(nodeAdmitted([24, 0, 0])).toBe(true);
    expect(nodeAdmitted([20, 99, 99])).toBe(false);
    expect(parseNodeVersion("v22.19.0")).toEqual([22, 19, 0]);
    expect(parseNodeVersion("sh: node: not found")).toBeNull();
  });

  it.each([
    ["22.18.9", "22.18.9", /has Node 22\.18\.9; .*Node >= 22\.19\.0/],
    ["none", "none", /has no node on its PATH; .*Node >= 22\.19\.0/],
  ])("refuses Node %s, removing the container it started", async (node, found, note) => {
    const { cli, calls } = fakeCli({ node });
    const result = await ensureContainer("12345678abcdef", TARGET, paths, {
      cli,
      nonce: () => "n1",
    });
    expect(result).toMatchObject({ ok: false, state: "node-too-old", found });
    expect(result.ok ? "" : result.note).toMatch(note);
    expect(calls.at(-1)).toBe("rm c-new");
  });

  it.each(["22.19.0", "24.0.0"])("admits Node %s and keeps the container", async (node) => {
    const { cli, calls } = fakeCli({ node });
    const result = await ensureContainer("12345678abcdef", TARGET, paths, {
      cli,
      nonce: () => "n1",
    });
    expect(result).toMatchObject({ ok: true, container: { id: "c-new", imageId: IMAGE.id } });
    expect(calls.filter((c) => c.startsWith("rm"))).toEqual([]);
  });
});

describe("the managed container (D5)", () => {
  it("starts one with its labels, same-path mounts, HOME and the bytecode prefix", async () => {
    const { cli, runs } = fakeCli();
    await ensureContainer("12345678abcdef", { ...TARGET, env: { A: "1" } }, paths, {
      cli,
      pid: 42,
      user: { uid: 7, gid: 8 },
      nonce: () => "n1",
    });
    const [run] = runs;
    expect(run?.name).toBe("squeal-ct-12345678-backend-n1");
    expect(run?.labels).toEqual({
      "org.squeal.managed": "true",
      "org.squeal.worktree": "12345678abcdef",
      "org.squeal.target": "backend",
      "org.squeal.image": IMAGE.id,
      "org.squeal.pid": "42",
      "org.squeal.config": expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(run?.user).toEqual({ uid: 7, gid: 8 });
    expect(run?.mounts.map((m) => [m.source === m.target, m.readonly === true])).toEqual([
      [true, false],
      [true, true],
      [true, false],
      [true, false],
    ]);
    expect(run?.env).toEqual({
      HOME: "/tmp",
      PYTHONPYCACHEPREFIX: `${paths.worktreeCacheDir}/pycache`,
      A: "1",
    });
  });

  it("refuses a missing image without running anything else", async () => {
    const { cli, calls } = fakeCli({ imageInspect: async () => null });
    const result = await ensureContainer("w", TARGET, paths, { cli });
    expect(result).toMatchObject({ ok: false, state: "image-missing" });
    expect(result.ok ? "" : result.note).toMatch(/never builds or pulls/);
    expect(calls).toEqual([]);
  });

  it("refuses a missing mount source without docker run", async () => {
    rmSync(paths.worktreeLogRoot, { recursive: true });
    const { cli, calls } = fakeCli();
    const result = await ensureContainer("w", TARGET, paths, { cli });
    expect(result).toMatchObject({ ok: false, state: "mount-source-missing" });
    expect(calls.some((c) => c.startsWith("run"))).toBe(false);
  });

  it("reports an unreachable Docker", async () => {
    const { cli } = fakeCli({
      imageInspect: async () => {
        throw new Error("Cannot connect to the Docker daemon");
      },
    });
    expect(await ensureContainer("w", TARGET, paths, { cli })).toMatchObject({
      ok: false,
      state: "docker-unreachable",
    });
  });

  it("reuses its own running container on the same image and replaces one on a rebuilt image", async () => {
    const own = (id: string, image: string): ManagedListing => ({
      id,
      name: `n-${id}`,
      state: "running",
      worktree: "w",
      target: "backend",
      image,
      pid: "42",
    });
    const same = fakeCli({ listed: [own("c-old", IMAGE.id)] });
    const reused = await ensureContainer("w", TARGET, paths, { cli: same.cli, pid: 42 });
    expect(reused).toMatchObject({ ok: true, container: { id: "c-old" } });
    expect(same.calls.some((c) => c.startsWith("run") || c.startsWith("rm"))).toBe(false);

    const rebuilt = fakeCli({ listed: [own("c-old", "sha256:old")] });
    const fresh = await ensureContainer("w", TARGET, paths, { cli: rebuilt.cli, pid: 42 });
    expect(fresh).toMatchObject({ ok: true, container: { id: "c-new" } });
    expect(rebuilt.calls.indexOf("rm c-old")).toBeLessThan(
      rebuilt.calls.findIndex((c) => c.startsWith("run")),
    );
  });

  it("leaves a container another live daemon owns alone", async () => {
    const other: ManagedListing = {
      id: "c-other",
      name: "n",
      state: "running",
      worktree: "w",
      target: "backend",
      image: IMAGE.id,
      pid: "99",
    };
    const { cli, calls } = fakeCli({ listed: [other] });
    const result = await ensureContainer("w", TARGET, paths, {
      cli,
      pid: 42,
      isPidAlive: () => true,
    });
    expect(result).toMatchObject({ ok: true, container: { id: "c-new" } });
    expect(calls).not.toContain("rm c-other");
  });

  it("closes by removing its container", async () => {
    const { cli, calls } = fakeCli();
    const result = await ensureContainer("w", TARGET, paths, { cli });
    if (!result.ok) throw new Error(result.note);
    await result.container.close();
    expect(calls.at(-1)).toBe("rm c-new");
  });
});

describe("rebuild detection (D6.2)", () => {
  it("tells an unchanged, a rebuilt and a removed image apart", async () => {
    const { cli } = fakeCli();
    expect(await checkImage(cli, "sb/backend", IMAGE.id)).toEqual({
      changed: false,
      imageId: IMAGE.id,
    });
    expect(await checkImage(cli, "sb/backend", "sha256:old")).toEqual({
      changed: true,
      imageId: IMAGE.id,
    });
    const gone = fakeCli({ imageInspect: async () => null });
    expect(await checkImage(gone.cli, "sb/backend", IMAGE.id)).toEqual({ missing: true });
  });
});

describe("mount proof (D6.1)", () => {
  it("admits the worktree's own device and inode and refuses any other or none", () => {
    const own = statSync(paths.worktreeRoot);
    const target = "backend";
    expect(proveMount(paths.worktreeRoot, { dev: own.dev, ino: own.ino }, target)).toEqual({
      ok: true,
    });
    const other = statSync(paths.worktreeCacheDir);
    expect(
      proveMount(paths.worktreeRoot, { dev: other.dev, ino: other.ino }, target),
    ).toMatchObject({
      ok: false,
      state: "mount-mismatch",
    });
    expect(proveMount(paths.worktreeRoot, undefined, target)).toMatchObject({
      ok: false,
      state: "mount-mismatch",
      note: expect.stringMatching(/device:inode none/),
    });
  });

  it("ends the channel and removes the container on a mismatch", async () => {
    const { cli, calls } = fakeCli();
    const ensured = await ensureContainer("w", TARGET, paths, { cli });
    if (!ensured.ok) throw new Error(ensured.note);
    let killed = false;
    const channel = { kill: () => (killed = true) } as unknown as Parameters<
      typeof verifyMount
    >[2]["channel"];
    const result = await verifyMount(
      paths.worktreeRoot,
      { dev: 1, ino: 2 },
      {
        channel,
        container: ensured.container,
      },
    );
    expect(result).toMatchObject({ ok: false, state: "mount-mismatch" });
    expect(killed).toBe(true);
    expect(calls.at(-1)).toBe("rm c-new");
  });

  it("is sent by a host given rootStat, and by none without", async () => {
    const started = async (extra: Parameters<typeof inProcessHost>[2]) => {
      const host = inProcessHost(async () => fakeAdapter(), "0.0.0-test", extra);
      const reply = new Promise<HostStarted>((resolve) =>
        host.channel.output.once("data", (chunk: string) =>
          resolve((JSON.parse(frameOf(chunk) ?? "null") as { r: HostStarted }).r),
        ),
      );
      host.channel.write(
        encodeLine({
          id: 1,
          m: "start",
          a: [
            {
              protocol: 1,
              version: "0.0.0-test",
              runner: "vitest",
              options: { childEnv: {} },
              policy: POLICY,
            },
          ],
        }),
      );
      const r = await reply;
      host.channel.endInput();
      await host.served;
      return r;
    };
    const stat = rootStatOf(paths.worktreeRoot);
    expect(stat).toEqual({
      dev: statSync(paths.worktreeRoot).dev,
      ino: statSync(paths.worktreeRoot).ino,
    });
    expect((await started({ rootStat: () => stat })).rootStat).toEqual(stat);
    expect(await started({})).not.toHaveProperty("rootStat");
    expect(rootStatOf(join(dir, "gone"))).toBeUndefined();
  });
});

describe("orphan reaping (D5.4)", () => {
  it("removes the worktree's containers whose daemon is dead or unnamed, and no other", async () => {
    const listing = (id: string, pid: string): ManagedListing => ({
      id,
      name: id,
      state: "running",
      worktree: "w",
      target: "backend",
      image: IMAGE.id,
      pid,
    });
    const { cli, calls } = fakeCli({
      listed: [listing("alive", "10"), listing("dead", "11"), listing("unowned", "")],
    });
    const removed = await reapOrphanedContainers("w", { cli, isPidAlive: (pid) => pid === 10 });
    expect(removed).toEqual(["dead", "unowned"]);
    expect(calls[0]).toBe(`ps ${JSON.stringify({ "org.squeal.worktree": "w" })}`);
    expect(calls).not.toContain("rm alive");
  });
});

describe("startContainerHost", () => {
  it("starts runner-host over docker exec -i at the worktree's path and proves its mount", async () => {
    const argvs: string[][] = [];
    const { cli, calls } = fakeCli({
      spawnExec: (id, argv) => {
        argvs.push([id, ...argv]);
        return spawn(process.execPath, ["-e", "process.stdin.resume()"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      },
    });
    const host = await startContainerHost(
      "w",
      TARGET,
      paths,
      { squealCliPath: `${paths.squealBundleDir}/squeal.mjs`, runner: "pytest" },
      { cli },
    );
    if (!host.ok) throw new Error(host.note);
    expect(argvs).toEqual([
      [
        "c-new",
        "node",
        "--disable-warning=ExperimentalWarning",
        `${paths.squealBundleDir}/squeal.mjs`,
        "runner-host",
        paths.worktreeRoot,
        "--runner",
        "pytest",
      ],
    ]);
    const own = statSync(paths.worktreeRoot);
    expect(await host.verify({ dev: own.dev, ino: own.ino })).toEqual({ ok: true });
    expect(calls.some((c) => c.startsWith("rm"))).toBe(false);
    expect(await host.verify({ dev: own.dev, ino: own.ino + 1 })).toMatchObject({
      ok: false,
      state: "mount-mismatch",
    });
    expect(await host.channel.ended).toBe("signal SIGKILL");
    expect(calls.at(-1)).toBe("rm c-new");
  });

  it("returns the refusal and spawns nothing when the container is refused", async () => {
    const { cli, calls } = fakeCli({ node: "20.11.1" });
    const host = await startContainerHost(
      "w",
      TARGET,
      paths,
      { squealCliPath: "/x/squeal.mjs", runner: "node-test" },
      { cli },
    );
    expect(host).toMatchObject({ ok: false, state: "node-too-old", found: "20.11.1" });
    expect(calls.some((c) => c.startsWith("spawn"))).toBe(false);
  });
});
