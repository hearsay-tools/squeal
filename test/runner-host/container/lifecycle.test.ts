import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DockerCli, dockerCli } from "../../../src/core/runner-host/container/docker.js";
import { bundleRootFor } from "../../../src/core/runner-host/container/index.js";
import {
  type ContainerPaths,
  containerEnv,
  containerMounts,
  ensureContainer,
  LABELS,
  launchStamp,
  type ManagedTarget,
  reapOrphanedContainers,
} from "../../../src/core/runner-host/container/manager.js";
import { nodeAdmitted, proveMount } from "../../../src/core/runner-host/container/preflight.js";
import { createContainerRunner } from "../../../src/core/runner-host/container/runner.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";

/*
 * Spec 027 D5 and D6 (row 027-05) against the host's real Docker, skipped
 * where `docker info` fails. Only images already local are used, and a
 * missing one is never pulled. No local image has Node 22.19 or later, so
 * the device:inode proof reads `stat` inside a Node-less image, and the
 * Node check is faked only where a test needs a started container kept.
 */

const docker = (...args: string[]) =>
  spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
const available = docker("info", "--format", "{{.ServerVersion}}").status === 0;
/** A small local image with a shell and coreutils, or none. */
const IMAGE = available
  ? ["debian:bookworm-slim", "ubuntu:24.04"].find(
      (image) => docker("image", "inspect", "--format", "{{.Id}}", "--", image).status === 0,
    )
  : undefined;
const MISSING = "squeal-test/never-built:missing";
const RUN_ID = `t-${process.pid}-${Date.now().toString(36)}`;

/** The managed containers of `worktreeId`, as Docker lists them. */
function containersOf(worktreeId: string): string[] {
  const out = execFileSync(
    "docker",
    ["ps", "-aq", "--filter", `label=${LABELS.worktree}=${worktreeId}`],
    { encoding: "utf8" },
  );
  return out.split("\n").filter((line) => line !== "");
}

/** Paths under `root` that a uid other than the host user's owns. */
function foreignOwned(root: string, uid: number): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (statSync(path).uid !== uid) found.push(path);
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(root);
  return found;
}

describe.skipIf(IMAGE === undefined)("a managed container on the real Docker", () => {
  const image = IMAGE ?? "";
  const uid = process.getuid?.() ?? -1;
  let dir: string;
  let paths: ContainerPaths;
  let worktreeId: string;
  let n = 0;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "squeal-ct-life-"));
    paths = {
      worktreeRoot: join(dir, "wt"),
      squealBundleDir: join(dir, "bundle"),
      worktreeCacheDir: join(dir, "cache"),
      worktreeLogRoot: join(dir, "logs"),
    };
    for (const path of Object.values(paths)) mkdirSync(path);
    worktreeId = `${RUN_ID}-${n++}`;
  });
  afterEach(() => {
    const left = containersOf(worktreeId);
    if (left.length > 0) execFileSync("docker", ["rm", "-f", ...left]);
    rmSync(dir, { recursive: true, force: true });
  });
  afterAll(() => {
    const out = execFileSync(
      "docker",
      ["ps", "-aq", "--filter", `label=${LABELS.managed}=true`, "--filter", "name=squeal-ct-t-"],
      { encoding: "utf8" },
    );
    const left = out.split("\n").filter((line) => line !== "");
    if (left.length > 0) execFileSync("docker", ["rm", "-f", ...left]);
  });

  const target = (over: Partial<ManagedTarget> = {}): ManagedTarget => ({
    name: "backend",
    image,
    network: "none",
    ...over,
  });

  it("refuses a missing image and pulls nothing", async () => {
    const result = await ensureContainer(worktreeId, target({ image: MISSING }), paths);
    expect(result).toMatchObject({ ok: false, state: "image-missing" });
    expect(docker("image", "inspect", "--", MISSING).status).not.toBe(0);
    expect(containersOf(worktreeId)).toEqual([]);
  });

  it("refuses an image without Node 22.19 and removes the container it started", async () => {
    const result = await ensureContainer(worktreeId, target(), paths);
    expect(result).toMatchObject({ ok: false, state: "node-too-old", found: "none" });
    expect(result.ok ? "" : result.note).toMatch(/Node >= 22\.19\.0/);
    expect(containersOf(worktreeId)).toEqual([]);
  });

  it("refuses a missing mount source and starts nothing", async () => {
    rmSync(paths.worktreeCacheDir, { recursive: true });
    const result = await ensureContainer(worktreeId, target(), paths);
    expect(result).toMatchObject({ ok: false, state: "mount-source-missing" });
    expect(containersOf(worktreeId)).toEqual([]);
    expect(() => statSync(paths.worktreeCacheDir)).toThrow();
  });

  it("labels, mounts at the same path as the host user, proves the mount and closes to zero", async () => {
    const real = dockerCli();
    // The image has no Node: only the Node check answers as a 22.19 image would.
    const cli: DockerCli = {
      ...real,
      execSyncText: (id, argv, ms) =>
        argv[0] === "node"
          ? Promise.resolve({ code: 0, stdout: "22.19.0\n", stderr: "" })
          : real.execSyncText(id, argv, ms),
    };
    const result = await ensureContainer(worktreeId, target(), paths, { cli });
    if (!result.ok) throw new Error(result.note);
    const { container } = result;

    const [listed] = await real.psManaged({ labels: { [LABELS.worktree]: worktreeId } });
    expect(listed).toMatchObject({
      id: container.id,
      state: "running",
      target: "backend",
      image: container.imageId,
      pid: String(process.pid),
    });
    expect(container.name).toMatch(
      new RegExp(`^squeal-ct-${worktreeId.slice(0, 8)}-backend-[0-9a-f]{6}$`),
    );

    // D6: the root's device and inode inside are the host's own; another path's are not.
    const stat = await real.execSyncText(container.id, ["stat", "-c", "%d %i", paths.worktreeRoot]);
    const [dev, ino] = stat.stdout.trim().split(" ").map(Number);
    expect(proveMount(paths.worktreeRoot, { dev: dev ?? 0, ino: ino ?? 0 }, "backend")).toEqual({
      ok: true,
    });
    const baked = await real.execSyncText(container.id, ["stat", "-c", "%d %i", "/tmp"]);
    const [bdev, bino] = baked.stdout.trim().split(" ").map(Number);
    expect(
      proveMount(paths.worktreeRoot, { dev: bdev ?? 0, ino: bino ?? 0 }, "backend"),
    ).toMatchObject({ ok: false, state: "mount-mismatch" });

    // Writes into every rw mount are the host user's; the bundle is read-only.
    const env = containerEnv(paths, target());
    const write = await real.execSyncText(container.id, [
      "sh",
      "-c",
      [
        `mkdir -p "${paths.worktreeRoot}/sub" "${env.PYTHONPYCACHEPREFIX}"`,
        `touch "${paths.worktreeRoot}/sub/f" "${paths.worktreeLogRoot}/log" "${env.PYTHONPYCACHEPREFIX}/x.pyc"`,
        `echo "$HOME"`,
        `touch "${paths.squealBundleDir}/no" 2>/dev/null && echo writable || echo readonly`,
      ].join(" && "),
    ]);
    expect(write.code).toBe(0);
    expect(write.stdout.trim().split("\n")).toEqual(["/tmp", "readonly"]);
    expect(foreignOwned(dir, uid)).toEqual([]);
    expect(containerMounts(paths).every((m) => m.source === m.target)).toBe(true);

    // The same daemon asks again: the running container is reused.
    const again = await ensureContainer(worktreeId, target(), paths, { cli });
    expect(again).toMatchObject({ ok: true, container: { id: container.id } });

    await container.close();
    expect(containersOf(worktreeId)).toEqual([]);
  });

  it("replaces a same-image container whose launch config changed (review 0.1.643 N3)", async () => {
    const real = dockerCli();
    const cli: DockerCli = {
      ...real,
      execSyncText: (id, argv, ms) =>
        argv[0] === "node"
          ? Promise.resolve({ code: 0, stdout: "22.19.0\n", stderr: "" })
          : real.execSyncText(id, argv, ms),
    };
    const first = await ensureContainer(worktreeId, target({ env: { A: "1" } }), paths, { cli });
    if (!first.ok) throw new Error(first.note);
    const [listed] = containersOf(worktreeId);
    const stamp = execFileSync(
      "docker",
      ["inspect", "--format", `{{index .Config.Labels "${LABELS.config}"}}`, first.container.id],
      { encoding: "utf8" },
    ).trim();
    expect(stamp).toBe(launchStamp(paths, target({ env: { A: "1" } })));
    expect(listed).toBe(first.container.id.slice(0, 12));

    // The same image, owner and state: reused only while the stamp matches.
    const same = await ensureContainer(worktreeId, target({ env: { A: "1" } }), paths, { cli });
    expect(same).toMatchObject({ ok: true, container: { id: first.container.id } });
    const changedEnv = await ensureContainer(worktreeId, target({ env: { A: "2" } }), paths, {
      cli,
    });
    if (!changedEnv.ok) throw new Error(changedEnv.note);
    expect(changedEnv.container.id).not.toBe(first.container.id);
    expect(containersOf(worktreeId)).toEqual([changedEnv.container.id.slice(0, 12)]);

    // Another bundle mount: replaced too, so a stale bundle never serves a run.
    const bundle = join(dir, "bundle-2");
    mkdirSync(bundle);
    const moved = await ensureContainer(
      worktreeId,
      target({ env: { A: "2" } }),
      { ...paths, squealBundleDir: bundle },
      { cli },
    );
    if (!moved.ok) throw new Error(moved.note);
    expect(moved.container.id).not.toBe(changedEnv.container.id);
    expect(containersOf(worktreeId)).toEqual([moved.container.id.slice(0, 12)]);
    await moved.container.close();
    expect(containersOf(worktreeId)).toEqual([]);
  });

  it("reaps a container whose daemon is dead, and keeps one whose daemon lives", async () => {
    const real = dockerCli();
    const cli: DockerCli = {
      ...real,
      execSyncText: () => Promise.resolve({ code: 0, stdout: "24.0.0\n", stderr: "" }),
    };
    const dead = await ensureContainer(worktreeId, target({ name: "dead" }), paths, {
      cli,
      pid: 2_147_483_000,
    });
    const live = await ensureContainer(worktreeId, target({ name: "live" }), paths, { cli });
    if (!dead.ok || !live.ok) throw new Error("a container did not start");
    expect(containersOf(worktreeId)).toHaveLength(2);

    expect(await reapOrphanedContainers(worktreeId)).toEqual([dead.container.id]);
    expect(containersOf(worktreeId)).toEqual([live.container.id.slice(0, 12)]);
    // A container without Squeal's label is never removed.
    expect(await real.removeManaged("0123456789ab")).toBe(false);
    await live.container.close();
    expect(containersOf(worktreeId)).toEqual([]);
  });
});

/** Squeal's built bundle and its CLI, which a container runs `runner-host` from. */
const BUNDLE = join(import.meta.dirname, "../../../plugins/claude-code/dist");
const BUNDLE_CLI = join(BUNDLE, "cli", "squeal.mjs");
const VERSION = (
  JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8")) as {
    version: string;
  }
).version;

/** A local image whose `NODE_VERSION` is 22.19 or later; never pulled. */
function localNodeImage(): string | undefined {
  const listed = docker("images", "--format", "{{.Repository}}:{{.Tag}}");
  if (listed.status !== 0) return undefined;
  return listed.stdout
    .split("\n")
    .filter((ref) => ref !== "" && !ref.includes("<none>"))
    .find((ref) => {
      const env = docker("image", "inspect", "--format", "{{json .Config.Env}}", "--", ref);
      const found = /"NODE_VERSION=v?(\d+)\.(\d+)/.exec(env.stdout);
      return found !== null && nodeAdmitted([Number(found[1]), Number(found[2]), 0]);
    });
}
const NODE_IMAGE = available && existsSync(BUNDLE_CLI) ? localNodeImage() : undefined;

/** Processes in `containerId` other than its `sleep` and `docker-init`. */
function testProcesses(containerId: string): string[] {
  const ps = docker("exec", containerId, "ps", "-eo", "args=");
  return ps.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^(sleep infinity|\/sbin\/docker-init|ps -eo)/.test(line));
}

// Review 0.1.643 N2: a real protocol start, a hanging test, and its stop paths, where an
// already-local Node 22.19+ image exists. Skipped otherwise: Squeal's tests never pull one.
describe.skipIf(NODE_IMAGE === undefined)("a real runner host in a container (N2)", () => {
  let dir: string;
  let paths: ContainerPaths;
  const worktreeId = `${RUN_ID}-n2`;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-ct-n2-")));
    const bundleDir = bundleRootFor(BUNDLE_CLI);
    if (bundleDir === null) throw new Error(`bundle root not found for ${BUNDLE_CLI}`);
    paths = {
      worktreeRoot: join(dir, "wt"),
      squealBundleDir: bundleDir,
      worktreeCacheDir: join(dir, "cache"),
      worktreeLogRoot: join(dir, "logs"),
    };
    for (const path of [paths.worktreeRoot, paths.worktreeCacheDir, paths.worktreeLogRoot]) {
      mkdirSync(path);
    }
    mkdirSync(join(paths.worktreeCacheDir, "tmp"));
    writeFileSync(
      join(paths.worktreeRoot, "hang.test.cjs"),
      `const { test } = require("node:test");
test("hangs", () => {
  require("node:child_process").spawn("sleep", ["1000"], { stdio: "ignore" });
  return new Promise(() => {});
});
`,
    );
  });
  afterEach(() => {
    const left = containersOf(worktreeId);
    if (left.length > 0) execFileSync("docker", ["rm", "-f", ...left]);
    rmSync(dir, { recursive: true, force: true });
  });

  const open = () =>
    createContainerRunner({
      runner: "node-test",
      adapterVersion: "test",
      traits: NO_TRAITS,
      worktreeId,
      project: "p",
      targetName: "node",
      target: {
        image: NODE_IMAGE ?? "",
        network: "none",
        keyMode: "build-content",
        dockerfileInputs: [],
        dependencyServices: [],
        env: {},
      },
      consent: () => ({ enabled: true, targets: "all" }),
      paths,
      squealCliPath: BUNDLE_CLI,
      version: VERSION,
      start: {
        options: {
          childEnv: {},
          process: {
            project: { name: "p", argv: [], env: {}, include: ["*.test.cjs"] },
            tempDir: join(paths.worktreeCacheDir, "tmp"),
          },
        },
        policy: () => ({
          observe: false,
          exclude: [],
          excludeProjects: [],
          coverage: false,
          coverageChildren: false,
          tierSize: 1,
        }),
      },
      note: () => {},
    });

  it("reaps a cancelled run, then the exec's end, and closes to zero containers", {
    timeout: 60_000,
  }, async () => {
    const runner = await open();
    const [file] = await runner.testFiles();
    if (file === undefined) throw new Error("the host listed no test file");
    const [container] = containersOf(worktreeId);
    if (container === undefined) throw new Error("no managed container");

    // Cancel: the run's processes are stopped inside the container.
    const stop = new AbortController();
    const running = runner.run([file], {
      runId: "n2-cancel",
      logDir: paths.worktreeLogRoot as AbsolutePath,
      timeoutMs: null,
      stop: stop.signal,
    });
    await vi.waitFor(() => expect(testProcesses(container).join("\n")).toMatch(/sleep 1000/), {
      timeout: 30_000,
      interval: 250,
    });
    stop.abort(new Error("n2 cancel"));
    expect((await running).completedFiles).toEqual([]);
    await vi.waitFor(
      () => expect(testProcesses(container).join("\n")).not.toMatch(/sleep 1000|hang\.test/),
      {
        timeout: 30_000,
        interval: 250,
      },
    );

    // The exec killed mid-run: Docker ends its stdin, and the host reaps the run.
    const again = runner.run([file], {
      runId: "n2-eof",
      logDir: paths.worktreeLogRoot as AbsolutePath,
      timeoutMs: null,
    });
    await vi.waitFor(() => expect(testProcesses(container).join("\n")).toMatch(/sleep 1000/), {
      timeout: 30_000,
      interval: 250,
    });
    execFileSync("pkill", ["-KILL", "-f", `docker exec --interactive ${container}`]);
    await again.catch(() => null);
    await vi.waitFor(() => expect(testProcesses(container)).toEqual([]), {
      timeout: 30_000,
      interval: 250,
    });

    await runner.close();
    expect(containersOf(worktreeId)).toEqual([]);
  });
});
