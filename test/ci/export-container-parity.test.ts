import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageOn } from "../../src/core/code/coverage/runtime.js";
import { readPolicy } from "../../src/core/daemon/policy.js";
import { configFieldHash } from "../../src/core/keys/environment-descriptor.js";
import {
  applyContainerEnvironment,
  type ContainerProbe,
  containerCore,
  containerKeyDescriptor,
  hashInputs,
  probeLocalContainer,
} from "../../src/core/runner-host/container/key.js";
import { exportResults } from "../../src/core/store/transfer.js";
import { decodeBundle, type ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { importResults } from "../../src/core/store/transfer-import.js";
import type { WorktreeId } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { NodeTestProject } from "../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { reporterPair, withoutNodeOptions } from "../runners/node-test/ci-record-kit.js";
import { openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";
import { headerOf } from "./export-harness.js";
import { ci, cloneOf, committed, scratch } from "./fixture.js";

/*
 * Spec 027 D7.2 and review 0.1.644 B3 (row 027-06): `squeal ci record` and
 * `squeal ci export` of a real `node --test` run, inside the image of a
 * `build-content` container target, key its entry as a developer's managed
 * container run of the same build keys it: another image ID and image env,
 * the same packages, `dockerfileInputs` and target env. Its import makes
 * the managed files current; a host entry beside it keys as on the host;
 * a job run with another value of the target's env matches nothing.
 */

const SLOW = { timeout: 300_000 } as const;
const DOCKERFILE = "FROM node:22\nRUN npm ci\n";
const BACKEND = {
  image: "example:latest",
  dockerfileInputs: ["Dockerfile"],
  env: { MODE: "test" },
};

const test = (name: string) =>
  `const { test } = require("node:test");\nconst assert = require("node:assert");\ntest(${JSON.stringify(name)}, () => assert.equal(1 + 1, 2));\n`;

function fixture(dir: string): string {
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-export-container", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    "squeal.config.json": JSON.stringify({
      nodeTest: [
        { name: "unit", include: ["*.test.cjs"], container: "backend" },
        { name: "host", include: ["host/*.test.cjs"] },
      ],
      containers: { backend: BACKEND },
    }),
    Dockerfile: DOCKERFILE,
    "a.test.cjs": test("in the container"),
    "host/h.test.cjs": test("on the host"),
  });
}

/** `ci record` of each entry's `node --test` in `root`, then `ci export` in a clone, with `MODE`. */
async function ciJob(origin: string, name: string, mode: string): Promise<ResultsBundle> {
  const root = cloneOf(origin, `${name}-record`);
  const parts = join(dirname(origin), `${name}-parts`);
  const env = { ...withoutNodeOptions(), CI: "true", MODE: mode };
  for (const files of [["a.test.cjs"], ["host/h.test.cjs"]]) {
    const run = [process.execPath, "--test", ...reporterPair(), ...files];
    const recorded = await ci(["record", "--out", parts, "--", ...run], root, env);
    expect(recorded.code, recorded.said).toBe(0);
  }
  const exportRoot = cloneOf(origin, `${name}-export`);
  const out = join(dirname(origin), `${name}.json.gz`);
  const exported = await ci(["export", "--parts", parts, "--out", out], exportRoot, env);
  expect(exported.code, exported.said).toBe(0);
  const bundle = decodeBundle(readFileSync(out));
  if (typeof bundle === "string") throw new Error(bundle);
  return bundle;
}

/** As `runner.ts` keys a managed container: an image of its own ID and env. */
function managedDescriptor(root: string, probe: ContainerProbe) {
  return containerKeyDescriptor({
    keyMode: "build-content",
    image: {
      id: "sha256:developer-build",
      repoDigests: [],
      env: ["PATH=/usr/bin", "EXTRA_IMAGE_VAR=1"],
      architecture: "amd64",
      os: "linux",
    },
    probe,
    dockerfileInputs: hashInputs(root, BACKEND.dockerfileInputs),
    targetEnv: BACKEND.env,
    services: [],
  });
}

/** A node:test adapter for `project` that counts the files it runs, in the container's key space when `probe` is given. */
async function adapterOf(
  root: string,
  project: NodeTestProject,
  ran: string[],
  probe: ContainerProbe | null,
): Promise<RunnerAdapter> {
  // With coverage as the daemon's runner host builds it (`runner-host/runners.ts`).
  const policy = readPolicy(root);
  const coverage = {
    enabled: () => coverageOn(policy),
    children: () => policy.coverage.children,
    collected: () => {},
  };
  const adapter = await createNodeTestAdapter(project, { root, coverage });
  return {
    ...adapter,
    environment: async () =>
      probe === null
        ? adapter.environment()
        : applyContainerEnvironment(
            await adapter.environment(),
            managedDescriptor(root, probe),
            containerCore(probe, "0.0.0-test"),
          ),
    run: (files: readonly TestFileRef[], options) => {
      ran.push(...files.map((f) => f.path));
      return adapter.run(files, options);
    },
  };
}

/** A developer's daemon in a clone of `origin`: `unit` in its managed container, `host` on the host; `bundle` imported first. */
async function daemon(origin: string, name: string, probe: ContainerProbe, bundle?: ResultsBundle) {
  const root = cloneOf(origin, name);
  const common = join(root, ".git");
  const store = openRepoStore(common);
  if (bundle !== undefined) {
    importResults(store, bundle, { importId: "ci", fileHash: "h", now: Date.now() });
  }
  const policy = { ...readPolicy(root), baseline: { onStart: "lookup-then-run-missing" } } as const;
  const [unit, host] = policy.nodeTest as [NodeTestProject, NodeTestProject];
  const ran: string[] = [];
  const h = await openHarness(root, store, common, {
    policy,
    parts: async () => [
      await adapterOf(root, unit, ran, probe),
      await adapterOf(root, host, ran, null),
    ],
  });
  await h.scheduler.start();
  await h.quiet();
  return { root, h, ran };
}

const environment = (bundle: ResultsBundle, project: string) =>
  bundle.environments.find((e) => e.project === project);
const keys = (bundle: ResultsBundle, project: string) =>
  bundle.testFiles.filter((f) => f.project === project).map((f) => [f.path, f.key]);

describe("ci export inside a build-content container's image (review 0.1.644 B3)", () => {
  it(
    "keys as the managed container run, and its import makes the managed files current",
    SLOW,
    async () => {
      const origin = fixture(scratch("ci-export-container"));
      const probe = await probeLocalContainer();
      const ci = await ciJob(origin, "ci", "test");

      // 1. The container entry's environment holds the build-content descriptor of this build.
      const sha = createHash("sha256").update(DOCKERFILE).digest("hex");
      const expected = containerKeyDescriptor({
        keyMode: "build-content",
        probe,
        dockerfileInputs: [["Dockerfile", sha]],
        targetEnv: { MODE: "test" },
        services: [],
      });
      expect(expected).toMatchObject({
        dockerfileInputs: [["Dockerfile", sha]],
        env: [["MODE", "test"]],
      });
      expect(environment(ci, "unit")?.descriptor?.config.container).toBe(configFieldHash(expected));

      // 2. A developer's managed run of the same build keys bit for bit alike.
      const managed = await daemon(origin, "managed", probe);
      expect([...managed.ran].sort()).toEqual(["a.test.cjs", "host/h.test.cjs"]);
      const header = await headerOf(managed.root);
      const { bundle: own } = exportResults(
        managed.h.store,
        managed.h.worktreeId as WorktreeId,
        header,
      );
      expect(environment(ci, "unit")?.hash).toBe(environment(own, "unit")?.hash);
      expect(keys(ci, "unit")).toEqual(keys(own, "unit"));
      expect(keys(ci, "unit")).toHaveLength(1);

      // 4. The host entry stays outside the container's key space, keyed as on the host.
      expect(environment(ci, "host")?.descriptor?.config).not.toHaveProperty("container");
      expect(environment(ci, "host")?.hash).toBe(environment(own, "host")?.hash);
      expect(keys(ci, "host")).toEqual(keys(own, "host"));
      expect(environment(ci, "host")?.hash).not.toBe(environment(ci, "unit")?.hash);

      // 3. Imported into a fresh developer clone, the CI passes are current: nothing runs.
      const developer = await daemon(origin, "developer", probe, ci);
      expect(developer.ran).toEqual([]);

      // 5. A job run with another value of the target's env matches nothing managed.
      const other = await ciJob(origin, "other", "other");
      expect(environment(other, "unit")?.hash).not.toBe(environment(own, "unit")?.hash);
      expect(keys(other, "unit")).not.toEqual(keys(own, "unit"));
      expect(environment(other, "host")?.hash).toBe(environment(own, "host")?.hash);
    },
  );
});
