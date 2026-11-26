import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import type { LoadedPolicy } from "../../src/core/types/policy.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(config: object): LoadedPolicy {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-containers-"));
  dirs.push(dir);
  writeFileSync(join(dir, POLICY_FILE), JSON.stringify(config));
  return loadPolicy(dir);
}

const BACKEND = {
  image: "saas-boilerplate/backend",
  network: "{composeProject}_default",
  workdir: "/app",
  dockerfileInputs: ["packages/backend/Dockerfile", "packages/backend/uv.lock"],
  dependencyServices: ["db", "redis", "stripemock"],
  env: { DJANGO_SETTINGS_MODULE: "config.settings" },
};

describe("the containers key (spec 027 D4)", () => {
  it("keeps a declared target with build-content keying by default", () => {
    const { policy, problems } = load({ containers: { backend: BACKEND } });
    expect(problems).toEqual([]);
    expect(policy.containers).toEqual({ backend: { ...BACKEND, keyMode: "build-content" } });
  });

  it("fills every default for a target that names only its image", () => {
    const { policy } = load({ containers: { workers: { image: "sb/workers" } } });
    expect(policy.containers.workers).toEqual({
      image: "sb/workers",
      keyMode: "build-content",
      dockerfileInputs: [],
      dependencyServices: [],
      env: {},
    });
  });

  it("keeps the opt-in image-id key mode", () => {
    const { policy, problems } = load({
      containers: { backend: { image: "sb/backend", keyMode: "image-id" } },
    });
    expect(problems).toEqual([]);
    expect(policy.containers.backend?.keyMode).toBe("image-id");
  });

  it.each([
    ["no image", {}, 'has no "image"'],
    ["an unknown key", { image: "x", privileged: true }, 'has unknown key "privileged"'],
    ["an image that is an option", { image: "--privileged" }, '"image" must be an image name'],
    ["an image with a space", { image: "a b" }, '"image" must be an image name'],
    ["an empty network", { image: "x", network: "" }, '"network" must be a network name'],
    ["a network with a newline", { image: "x", network: "a\nb" }, '"network" must be'],
    ["a relative workdir", { image: "x", workdir: "app" }, '"workdir" must be an absolute'],
    ["an unknown key mode", { image: "x", keyMode: "digest" }, '"keyMode" must be'],
    ["an absolute input", { image: "x", dockerfileInputs: ["/etc/passwd"] }, '"dockerfileInputs"'],
    ["an input above the root", { image: "x", dockerfileInputs: ["../x"] }, '"dockerfileInputs"'],
    ["an empty input", { image: "x", dockerfileInputs: [""] }, '"dockerfileInputs"'],
    ["a service with a space", { image: "x", dependencyServices: ["a b"] }, '"dependencyServices"'],
    ["a service that is an option", { image: "x", dependencyServices: ["-d"] }, "service names"],
    ["an env value not a string", { image: "x", env: { A: 1 } }, '"env" must be'],
    ["a target that is not an object", "sb/x", "must be an object"],
  ])("leaves out a target with %s and keeps the others", (_, bad, why) => {
    const { policy, problems } = load({ containers: { bad, good: { image: "sb/good" } } });
    expect(Object.keys(policy.containers)).toEqual(["good"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^"containers\.bad" /);
    expect(problems[0]).toContain(why);
    expect(problems[0]).toMatch(/; it is left out$/);
  });

  it.each(["-x", "a b", "a/b", "a\\b", ""])("leaves out a target named %j", (name) => {
    const { policy, problems } = load({ containers: { [name]: { image: "x" } } });
    expect(policy.containers).toEqual({});
    expect(problems).toEqual([expect.stringContaining("has a name with a space")]);
  });

  it("is the default with one problem when it is not an object", () => {
    const { policy, problems } = load({ containers: ["backend"] });
    expect(policy.containers).toEqual({});
    expect(problems).toEqual([
      '"containers" must be an object from target name to a container target, got ["backend"]',
    ]);
  });
});

describe("a project's container (spec 027 D4)", () => {
  it("keeps pytest and node:test projects that name a declared target", () => {
    const { policy, problems } = load({
      containers: { backend: { image: "sb/backend" } },
      pytest: [{ name: "backend", include: ["tests/**/*.py"], container: "backend" }],
      nodeTest: [{ name: "web", include: ["**/*.test.js"], container: "backend" }],
    });
    expect(problems).toEqual([]);
    expect(policy.pytest[0]?.container).toBe("backend");
    expect(policy.nodeTest[0]?.container).toBe("backend");
  });

  it("skips a project that names a target containers does not declare", () => {
    const { policy, problems } = load({
      containers: { backend: { image: "sb/backend" } },
      pytest: [
        { name: "backend", include: ["t/*.py"], container: "backend" },
        { name: "workers", include: ["w/*.py"], container: "workers" },
        { name: "host", include: ["h/*.py"] },
      ],
      nodeTest: [{ name: "web", include: ["*.test.js"], container: "web" }],
    });
    expect(policy.pytest.map((p) => p.name)).toEqual(["backend", "host"]);
    expect(policy.nodeTest).toEqual([]);
    expect(problems).toEqual([
      '"nodeTest" project "web" names container "web", which "containers" does not declare; it is skipped',
      '"pytest" project "workers" names container "workers", which "containers" does not declare; it is skipped',
    ]);
  });

  it("skips a project whose target was left out as bad", () => {
    const { policy, problems } = load({
      containers: { backend: { image: "-bad" } },
      pytest: [{ name: "backend", include: ["t/*.py"], container: "backend" }],
    });
    expect(policy.pytest).toEqual([]);
    expect(problems).toHaveLength(2);
  });

  it.each([
    ["pytest", ""],
    ["pytest", 5],
    ["nodeTest", ""],
    ["nodeTest", null],
  ])("skips a %s project whose container is %j", (list, container) => {
    const { policy, problems } = load({
      containers: { backend: { image: "sb/backend" } },
      [list]: [{ name: "p", include: ["t/*"], container }],
    });
    expect(policy[list as "pytest" | "nodeTest"]).toEqual([]);
    expect(problems).toEqual([expect.stringContaining(`"${list}[0].container" must be`)]);
  });
});
