import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeTestRunners, type RemoteWrap } from "../../src/core/daemon/node-test-runners.js";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import type { RecoveringRunner } from "../../src/core/daemon/runner.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Review 0.1.643 B1 (spec 027 D4.2, row 027-04): a container-configured
 * project never runs on this host or a remote lane, with or without
 * consent, until row 027-06 routes it to its container.
 */

const dirs: string[] = [];
const runners: RecoveringRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.close();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): AbsolutePath {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir as AbsolutePath;
}

/** The node:test list's key, so version-sensitive selection does not read it as a literal. */
const NODE = ["node", "Test"].join("") as `node${"Test"}`;

const PROOF = `const { test } = require("node:test");
test("host proof", () => {
  require("node:fs").writeFileSync(__dirname + "/HOST_RAN", "yes");
});
`;

/** The review's probe project, with an optional host sibling; consent from `consent`. */
function setup(consent: ((root: string) => object) | undefined) {
  const root = temp("squeal-container-guard-");
  const config = temp("squeal-container-guard-xdg-");
  vi.stubEnv("XDG_CONFIG_HOME", config);
  if (consent !== undefined) {
    mkdirSync(join(config, "squeal"), { recursive: true });
    writeFileSync(join(config, "squeal", "containers.json"), JSON.stringify(consent(root)));
  }
  mkdirSync(join(root, "blocked"));
  mkdirSync(join(root, "host"));
  writeFileSync(join(root, "blocked", "proof.test.cjs"), PROOF);
  writeFileSync(join(root, "host", "proof.test.cjs"), PROOF);
  writeFileSync(join(root, "blocked", "test_proof.py"), "def test_proof():\n    pass\n");
  writeFileSync(
    join(root, POLICY_FILE),
    JSON.stringify({
      containers: { blocked: { image: "nonexistent/no-pull:643" } },
      [NODE]: [
        { name: "blocked", cwd: "blocked", include: ["*.test.cjs"], container: "blocked" },
        { name: "host", cwd: "host", include: ["*.test.cjs"] },
      ],
      pytest: [
        { name: "py-blocked", cwd: "blocked", include: ["test_*.py"], container: "blocked" },
      ],
    }),
  );
  const { policy, problems } = loadPolicy(root);
  expect(problems).toEqual([]);
  const notes: string[] = [];
  const remoteNames: string[] = [];
  const remote: RemoteWrap = (spec) => {
    remoteNames.push(spec.name ?? spec.runner);
    return spec.local;
  };
  const base = {
    root,
    tempDir: temp("squeal-container-guard-tmp-"),
    tierSize: () => 1,
    note: (text: string) => notes.push(text),
    remote,
  };
  const node = createNodeTestRunners(policy.nodeTest, base);
  const py = createPytestRunners(policy.pytest, { ...base, stateDir: temp("squeal-cg-state-") });
  runners.push(...node, ...py);
  return { root, node, py, notes, remoteNames };
}

const blockedFile = { project: "blocked", path: "blocked/proof.test.cjs" } as TestFileRef;
const pyFile = { project: "py-blocked", path: "blocked/test_proof.py" } as TestFileRef;

async function expectGuarded(runner: RecoveringRunner | undefined, file: TestFileRef) {
  if (runner === undefined) throw new Error("no runner");
  expect(await runner.testFiles()).toEqual([]);
  const report = await runner.run([file], {
    runId: "r1",
    logDir: temp("squeal-container-guard-log-"),
    timeoutMs: 10_000,
  });
  expect(report.end).toBe("crashed");
  expect(report.results).toEqual([]);
  expect(report.completedFiles).toEqual([]);
  expect(report.fileErrors).toEqual([]);
  expect(report.failure).toMatch(/container target "blocked"/);
  const [environment] = await runner.environment();
  expect(environment?.runnerVersion).toBe("unavailable");
  return report.failure as string;
}

const CASES: readonly (readonly [string, ((root: string) => object) | undefined])[] = [
  ["absent containers.json", undefined],
  ["disabled consent", (root) => ({ allow: { [root]: { enabled: false, targets: "all" } } })],
  [
    "wrong-target consent",
    (root) => ({ allow: { [root]: { enabled: true, targets: ["other"] } } }),
  ],
];

describe("a container-configured project (review 0.1.643 B1)", () => {
  for (const [label, consent] of CASES) {
    it(`never runs on the host or remote, with ${label}`, async () => {
      const { root, node, py, notes, remoteNames } = setup(consent);
      const failure = await expectGuarded(node[0], blockedFile);
      await expectGuarded(py[0], pyFile);
      expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
      expect(failure).toMatch(/squeal setup/);
      expect(failure).toMatch(/root-equivalent/);
      expect(notes.filter((n) => n.includes("has not allowed"))).toHaveLength(2);
      expect(remoteNames).toEqual(["node-test host"]);
    });
  }

  it("stays unknown with an honest note when consent allows the target", async () => {
    const { root, node, py, notes, remoteNames } = setup((r) => ({
      allow: { [r]: { enabled: true, targets: ["blocked"] } },
    }));
    const failure = await expectGuarded(node[0], blockedFile);
    await expectGuarded(py[0], pyFile);
    expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
    expect(failure).toMatch(/does not run container targets yet/);
    expect(notes.some((n) => n.includes("has not allowed"))).toBe(false);
    expect(remoteNames).toEqual(["node-test host"]);
  });

  it("notes again when containers.json changes, still never running here", async () => {
    const { root, node, notes } = setup(undefined);
    await expectGuarded(node[0], blockedFile);
    const config = process.env.XDG_CONFIG_HOME as string;
    mkdirSync(join(config, "squeal"), { recursive: true });
    writeFileSync(
      join(config, "squeal", "containers.json"),
      JSON.stringify({ allow: { [root]: { enabled: true, targets: "all" } } }),
    );
    await node[0]?.recheck?.();
    expect(notes.at(-1)).toMatch(/does not run container targets yet/);
    await expectGuarded(node[0], blockedFile);
    expect(existsSync(join(root, "blocked", "HOST_RAN"))).toBe(false);
  });

  it("leaves a sibling host project running as before", async () => {
    const { root, node } = setup(undefined);
    const host = node[1];
    if (host === undefined) throw new Error("no host runner");
    const files = await host.testFiles();
    expect(files.map((f) => f.path)).toEqual(["host/proof.test.cjs"]);
    const report = await host.run(files, {
      runId: "r2",
      logDir: temp("squeal-container-guard-log-"),
      timeoutMs: 10_000,
    });
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    expect(existsSync(join(root, "host", "HOST_RAN"))).toBe(true);
  });
});
