import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DockerCli, dockerCli } from "../../../src/core/runner-host/container/docker.js";
import {
  type ContainerPaths,
  containerEnv,
  containerMounts,
  ensureContainer,
  LABELS,
  type ManagedTarget,
  reapOrphanedContainers,
} from "../../../src/core/runner-host/container/manager.js";
import { proveMount } from "../../../src/core/runner-host/container/preflight.js";

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
