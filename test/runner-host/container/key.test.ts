import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { environmentHash } from "../../../src/core/keys/environment-hash.js";
import type { ImageInfo } from "../../../src/core/runner-host/container/docker.js";
import {
  applyContainerEnvironment,
  type ContainerKeyInputs,
  type ContainerProbe,
  ciContainerTargetEnv,
  containerCore,
  containerKeyDescriptor,
  hashInputs,
  inspectServices,
  localContainerKey,
  parsePackages,
  probeLocalContainer,
  wrapContainerEnvironmentAdapter,
} from "../../../src/core/runner-host/container/key.js";
import { onMachine } from "../../../src/core/runner-host/remote/remote-key.js";
import type { CoreEnvironmentInputs } from "../../../src/core/types/keys.js";
import {
  CONTAINER_TARGET_DEFAULTS,
  type ContainerTarget,
} from "../../../src/core/types/policy-containers.js";
import type { RunnerAdapter, RunnerEnvironment } from "../../../src/core/types/runner.js";

/*
 * Spec 027 D7 (row 027-06): a container target's results are keyed apart
 * from the host's; `build-content` keys what a separate build reproduces,
 * `image-id` the exact image; slot variables never key.
 */

const HOST: CoreEnvironmentInputs = {
  squealVersion: "0.1.0",
  nodeVersion: "v26.13.0",
  platform: "linux",
  arch: "x64",
  installedDependencies: "deps",
  env: {},
};
const RUNNER: RunnerEnvironment = {
  project: "backend",
  runnerName: "pytest",
  runnerVersion: "8.3.0",
  adapterVersion: "7",
  resolvedConfig: JSON.stringify({ args: ["-q"] }),
  files: [],
};
const IMAGE: ImageInfo = {
  id: "sha256:build-one",
  repoDigests: [],
  env: ["PATH=/usr/bin", "PYTHONUNBUFFERED=1"],
  architecture: "amd64",
  os: "linux",
};
const PROBE: ContainerProbe = {
  nodeVersion: "v22.19.0",
  platform: "linux",
  arch: "x64",
  packageManager: "dpkg",
  packages: ["libpq5=15.8", "python3=3.12.3"],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "squeal-ct-key-"));
  writeFileSync(join(dir, "Dockerfile"), "FROM python:3.12\nRUN uv sync\n");
  writeFileSync(join(dir, "uv.lock"), "lock-1\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function inputs(over: Partial<ContainerKeyInputs> = {}): ContainerKeyInputs {
  return {
    keyMode: "build-content" as const,
    image: IMAGE,
    probe: PROBE,
    dockerfileInputs: hashInputs(dir, ["Dockerfile", "uv.lock"]),
    targetEnv: { DJANGO_SETTINGS_MODULE: "config.settings" },
    services: [{ service: "db", image: "postgres:16", id: "sha256:pg", repoDigests: [] }],
    ...over,
  };
}

/** The hash the daemon keys the container environment of `over` by (`keying.ts`). */
function keyOf(over: Partial<ContainerKeyInputs> = {}): string {
  const made = inputs(over);
  const [environment] = applyContainerEnvironment(
    [RUNNER],
    containerKeyDescriptor(made),
    containerCore(made.probe, "0.1.0"),
  );
  if (environment?.core === undefined) throw new Error("no container core");
  return environmentHash(onMachine(HOST, environment.core), environment, () => null);
}

const hostKey = () => environmentHash(HOST, RUNNER, () => null);

describe("the container key space (D7.1)", () => {
  it("never collides with the host's key of the same project, even on the same machine", () => {
    const sameMachine: ContainerProbe = { ...PROBE, nodeVersion: HOST.nodeVersion };
    expect(keyOf()).not.toBe(hostKey());
    expect(keyOf({ probe: sameMachine })).not.toBe(hostKey());
    expect(keyOf({ keyMode: "image-id", probe: sameMachine })).not.toBe(hostKey());
  });

  it("keeps the inside config's fields and adds the container and its machine", () => {
    const [environment] = applyContainerEnvironment(
      [RUNNER],
      containerKeyDescriptor(inputs()),
      containerCore(PROBE, "0.1.0"),
    );
    expect(JSON.parse(environment?.resolvedConfig ?? "{}")).toMatchObject({
      args: ["-q"],
      container: { keyMode: "build-content" },
    });
    expect(environment?.core).toMatchObject({ nodeVersion: "v22.19.0", arch: "x64" });
  });
});

describe("build-content keys (D7.2, the default)", () => {
  it("matches across two builds with other image IDs and the same packages, inputs and env", () => {
    const rebuilt: ImageInfo = { ...IMAGE, id: "sha256:build-two", repoDigests: ["r@sha256:x"] };
    expect(keyOf({ image: rebuilt })).toBe(keyOf());
  });

  it("keys the target's env, never the image's, so no inspection is needed (review 0.1.644 B3)", () => {
    const other: ImageInfo = { ...IMAGE, env: ["PATH=/usr/bin", "EXTRA_IMAGE_VAR=1"] };
    expect(keyOf({ image: other })).toBe(keyOf());
    const { image: _image, ...noImage } = inputs();
    expect(containerKeyDescriptor({ ...noImage, keyMode: "build-content" })).toEqual(
      containerKeyDescriptor(inputs()),
    );
    expect(containerKeyDescriptor(inputs())).toMatchObject({
      env: [["DJANGO_SETTINGS_MODULE", "config.settings"]],
    });
    // `image-id` keeps keying the image's env.
    expect(keyOf({ keyMode: "image-id", image: other })).not.toBe(keyOf({ keyMode: "image-id" }));
  });

  it("re-keys on a one-line change of a dockerfileInputs file, and on a missing one", () => {
    const before = keyOf();
    writeFileSync(join(dir, "Dockerfile"), "FROM python:3.12\nRUN uv sync --frozen\n");
    const edited = keyOf({ dockerfileInputs: hashInputs(dir, ["Dockerfile", "uv.lock"]) });
    expect(edited).not.toBe(before);
    rmSync(join(dir, "uv.lock"));
    const missing = hashInputs(dir, ["Dockerfile", "uv.lock"]);
    expect(missing[1]).toEqual(["uv.lock", "missing"]);
    expect(keyOf({ dockerfileInputs: missing })).not.toBe(edited);
  });

  it("re-keys on an OS package change, a Node change and a dependency service's image", () => {
    const before = keyOf();
    expect(keyOf({ probe: { ...PROBE, packages: ["libpq5=15.9", "python3=3.12.3"] } })).not.toBe(
      before,
    );
    expect(keyOf({ probe: { ...PROBE, nodeVersion: "v24.1.0" } })).not.toBe(before);
    expect(keyOf({ services: [{ service: "db", image: "postgres:17" }] })).not.toBe(before);
  });

  it("keeps slot and per-worktree launch variables out of the key", () => {
    const before = keyOf();
    const slotted = {
      DJANGO_SETTINGS_MODULE: "config.settings",
      SQUEAL_SLOT: "3",
      SQUEAL_WORKTREE_SLOT: "abcd1234_3",
      TOX_PARALLEL_ENV: "abcd1234_3",
      HOME: "/tmp",
      PYTHONPYCACHEPREFIX: "/elsewhere/cache/pycache",
    };
    expect(keyOf({ targetEnv: slotted })).toBe(before);
    expect(keyOf({ image: { ...IMAGE, env: [...IMAGE.env, "SQUEAL_SLOT=2"] } })).toBe(before);
    expect(keyOf({ targetEnv: { DJANGO_SETTINGS_MODULE: "other" } })).not.toBe(before);
  });
});

describe("image-id keys (D7.2, opt-in)", () => {
  it("re-keys on another image ID with the same packages, inputs and env", () => {
    const rebuilt: ImageInfo = { ...IMAGE, id: "sha256:build-two" };
    expect(keyOf({ keyMode: "image-id", image: rebuilt })).not.toBe(keyOf({ keyMode: "image-id" }));
  });

  it("ignores dockerfileInputs, keys the single repo digest and never the slot variables", () => {
    const base = keyOf({ keyMode: "image-id" });
    expect(keyOf({ keyMode: "image-id", dockerfileInputs: [] })).toBe(base);
    expect(keyOf({ keyMode: "image-id", targetEnv: { SQUEAL_SLOT: "2" } })).toBe(
      keyOf({ keyMode: "image-id", targetEnv: {} }),
    );
    expect(
      keyOf({
        keyMode: "image-id",
        targetEnv: { DJANGO_SETTINGS_MODULE: "config.settings", SQUEAL_SLOT: "9" },
      }),
    ).toBe(base);
    const pulled: ImageInfo = { ...IMAGE, repoDigests: ["reg/sb@sha256:abc"] };
    expect(keyOf({ keyMode: "image-id", image: pulled })).not.toBe(base);
  });
});

describe("what the container shows of itself", () => {
  it("reads dpkg and apk inventories sorted, and none as empty", () => {
    expect(parsePackages("dpkg\nzlib1g=1.3\nbash=5.2\n")).toEqual({
      packageManager: "dpkg",
      packages: ["bash=5.2", "zlib1g=1.3"],
    });
    expect(parsePackages("apk\nmusl-1.2.5-r0\n")).toMatchObject({ packageManager: "apk" });
    expect(parsePackages("none\n")).toEqual({ packageManager: "none", packages: [] });
  });

  it("inspects running dependency services by their Compose label and never starts one", async () => {
    const asked: string[][] = [];
    const found = await inspectServices(
      {
        imageInspect: async (ref) =>
          ref === "postgres:16"
            ? { ...IMAGE, id: "sha256:pg", repoDigests: ["pg@sha256:1"] }
            : null,
      },
      ["db", "redis"],
      "sb-dev",
      async (args) => {
        asked.push([...args]);
        return args.some((a) => a.endsWith("service=db")) ? "postgres:16\n" : "";
      },
    );
    expect(found).toEqual([
      { service: "db", image: "postgres:16", id: "sha256:pg", repoDigests: ["pg@sha256:1"] },
      { service: "redis" },
    ]);
    expect(asked.every((args) => args[0] === "ps")).toBe(true);
    expect(asked[0]).toContain("--filter=label=com.docker.compose.project=sb-dev");
  });
});

describe("the key a CI job inside the image gives (D7.2, review 0.1.644 B3)", () => {
  const TARGET: ContainerTarget = {
    ...CONTAINER_TARGET_DEFAULTS,
    image: "example:latest",
    dockerfileInputs: ["Dockerfile", "uv.lock"],
    env: { DJANGO_SETTINGS_MODULE: "config.settings" },
  };
  const local = (env: NodeJS.ProcessEnv, target: ContainerTarget = TARGET) =>
    localContainerKey({ target, root: dir, squealVersion: "0.1.0", env, probe: async () => PROBE });

  it("reads this machine's Node, platform, arch and packages with no Docker", async () => {
    const probe = await probeLocalContainer();
    expect(probe).toMatchObject({ platform: process.platform, arch: process.arch });
    expect(probe.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    expect(["dpkg", "apk", "none"]).toContain(probe.packageManager);
    expect(probe.packages).toEqual([...probe.packages].sort());
  });

  it("resolves the target's env from the job: templates kept, others the job's, unset left out", () => {
    const target = {
      MODE: "test",
      DB: "app_{worktreeSlot}",
      PORT: "{slot}0",
      UNSET: "x",
      SQUEAL_SLOT: "1",
      HOME: "/root",
    };
    const job = { MODE: "other", DB: "app_ci", PORT: "9", SQUEAL_SLOT: "2", HOME: "/home/ci" };
    expect(ciContainerTargetEnv(target, job)).toEqual({
      MODE: "other",
      DB: "app_{worktreeSlot}",
      PORT: "{slot}0",
    });
    expect(
      Object.keys(ciContainerTargetEnv({ ["__proto__"]: "a" }, JSON.parse('{"__proto__":"a"}'))),
    ).toEqual(["__proto__"]);
  });

  it("equals the managed build-content key of the same inputs under any image ID and image env", async () => {
    const ci = await local({ DJANGO_SETTINGS_MODULE: "config.settings", GITHUB_SHA: "abc" });
    const managed = containerKeyDescriptor({
      ...inputs({ services: [] }),
      image: { ...IMAGE, id: "sha256:dev", env: ["PATH=/usr/bin", "EXTRA_IMAGE_VAR=1"] },
    });
    expect(ci.descriptor).toEqual(managed);
    expect(ci.core).toEqual(containerCore(PROBE, "0.1.0"));
    expect((await local({ DJANGO_SETTINGS_MODULE: "other" })).descriptor).not.toEqual(managed);
    expect((await local({})).descriptor).not.toEqual(managed);
  });

  it("keys a declared dependency service as not running, and an image-id target as no image", async () => {
    const withDb = await local(
      { DJANGO_SETTINGS_MODULE: "config.settings" },
      {
        ...TARGET,
        dependencyServices: ["db"],
      },
    );
    expect(withDb.descriptor).toMatchObject({ services: [["db", "not-running", []]] });
    const pinned = await local({}, { ...TARGET, keyMode: "image-id" });
    expect(pinned.descriptor).toMatchObject({ keyMode: "image-id", imageId: "ci-uninspected" });
    expect(pinned.descriptor).not.toEqual(containerKeyDescriptor(inputs({ keyMode: "image-id" })));
  });

  it("wraps only an adapter's environments; every other member answers as the adapter's own", async () => {
    class Adapter {
      readonly name = "node-test";
      readonly #files = ["a.test.mjs"];
      async environment() {
        return [RUNNER];
      }
      async testFiles() {
        return this.#files;
      }
    }
    const key = await local({ DJANGO_SETTINGS_MODULE: "config.settings" });
    const wrapped = wrapContainerEnvironmentAdapter(new Adapter() as unknown as RunnerAdapter, key);
    expect(wrapped.name).toBe("node-test");
    expect(await wrapped.testFiles()).toEqual(["a.test.mjs"]);
    expect(await wrapped.environment()).toEqual(
      applyContainerEnvironment([RUNNER], key.descriptor, key.core),
    );
  });
});
