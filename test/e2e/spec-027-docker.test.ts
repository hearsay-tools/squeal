import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
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
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { containerConsentPath } from "../../src/core/runner-host/container/consent.js";
import { LABELS } from "../../src/core/runner-host/container/manager.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import type { StatusSnapshot } from "../../src/core/types/status.js";
import { copyJestRuntime } from "../../src/harness/build.js";
import { daemonSuite, diagnose, type FixtureRepo, spawnCli, waitReady } from "../daemon/helpers.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { findPython, pythonEnv } from "../helpers/pytest-env.js";
import { buildPluginDist } from "./spec-026-build.js";

/*
 * Spec 027 Testing, end to end (row 027-07): fixture repositories, their
 * real daemons and the plugin's bundled `squeal` CLI built from this
 * worktree (`spec-026-build.ts`). Stage 1 needs no Docker: concurrent
 * pytest batches in slots, templated `env`, keys that no slot moves, and
 * the build-stage editable rule. Stage 2 without Docker: an unconsented
 * container project runs no `docker` command and says why, and status
 * shows and clears its `Containers:` line. Stage 2 on the host's Docker,
 * only where a Node 22.19+ image is already local (never pulled, never
 * built here): a run in the managed container on the live mount, an image
 * without Node refused, an orphan reaped, `squeal ps` and zero files the
 * host user does not own.
 */

/**
 * The plugin's `dist/` as `spec-026-build.ts` builds it, with the Jest
 * runtime too: the daemon mounts a bundle only when every runtime the
 * in-container host reads is in it (`bundleRootFor`, review 0.1.644 B1).
 */
const suite = daemonSuite({}, (options) => {
  const built = buildPluginDist(options);
  copyJestRuntime(dirname(dirname(built.cli)));
  return built;
});
const SMALL = resolve(import.meta.dirname, "../fixtures/pytest/small");
const MANUAL_VITEST = [{ name: "unit", runner: "vitest", at: "manual" }];
const GITIGNORE = "src/gen/\nnode_modules/\n.squeal-logs/\n.venv/\n";

/** `squeal <args>` in `repo` as its own process: exit code and output. */
async function cli(repo: FixtureRepo, ...args: string[]) {
  const run = spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
  const { code } = await run.exited;
  return { code, out: `${run.stdout()}${run.stderr()}` };
}

/** Polls `squeal status`'s snapshot until `done` holds, up to `ms`. */
async function settle(
  repo: FixtureRepo,
  what: string,
  done: (s: StatusSnapshot) => boolean,
  ms = 120_000,
): Promise<StatusSnapshot> {
  const started = Date.now();
  let last: StatusSnapshot | undefined;
  for (;;) {
    const s = readStatus(repo.root as never);
    if (s.available) {
      last = s;
      if (done(s)) return s;
    }
    if (Date.now() - started > ms) {
      throw new Error(`${what} not reached: ${JSON.stringify(last)}\n${diagnose(repo)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Current passing checks, file-level ones included. */
const passes = (s: StatusSnapshot) => s.breakdown.currentByOutcome.pass;
/** The daemon's notes, as one text. */
const notesOf = (s: StatusSnapshot) => s.daemonNotes.map((n) => n.text).join("\n");

/** A temp directory outside every git checkout, removed after the test. */
function outside(prefix: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/${prefix}`));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Python test that records its slot variables and templated env, and holds 1.5 s. */
const slotTest = (out: string, name: string) => `import json
import os
import time

def test_${name}():
    names = ["SQUEAL_SLOT", "SQUEAL_WORKTREE_SLOT", "TOX_PARALLEL_ENV", "REDIS_CONNECTION",
             "DB_CONNECTION", "SLOT0", "LITERAL"]
    seen = {n: os.environ.get(n) for n in names}
    seen["start"] = time.time()
    time.sleep(1.5)
    seen["end"] = time.time()
    with open(os.path.join(${JSON.stringify(out)}, "${name}-%d.json" % os.getpid()), "w") as f:
        json.dump(seen, f)
`;

/** The small pytest fixture synced into `py/` of `repo`, or `null` without uv's Python 3.13. */
function syncedPy(repo: FixtureRepo): string | null {
  const found = findPython("3.13");
  if (!found.ok) {
    if (process.env.CI) throw new Error(found.reason);
    return null;
  }
  const py = join(repo.root, "py");
  cpSync(SMALL, py, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.venv[^/]*|__pycache__|\.pytest_cache)$/.test(src),
  });
  execFileSync("uv", ["sync", "--locked", "--python", found.python], {
    cwd: py,
    env: pythonEnv(),
    stdio: "ignore",
  });
  return py;
}

describe("spec 027 stage 1 end to end, no Docker (row 027-07)", { timeout: 600_000 }, () => {
  it("runs concurrent batches in distinct slots with templated env, and no slot moves a key", async (ctx) => {
    const out = outside("sq-slots-");
    const policy = {
      baseline: { onStart: "lookup-only" },
      checks: MANUAL_VITEST,
      runner: { tierSize: 4 },
      pytest: [
        {
          name: "py",
          cwd: "py",
          include: ["tests/test_slot_*.py"],
          batchSize: 1,
          slots: { toxParallelEnv: true, max: 2 },
          env: {
            REDIS_CONNECTION: "redis://redis:6379/{slot}",
            DB_CONNECTION: '{"dbname":"workers_test_{worktreeSlot}","port":5432}',
            SLOT0: "{slot0}",
            LITERAL: "{unknown}",
          },
        },
      ],
    };
    const repo = suite.fixture({
      "squeal.config.json": runMissingConfig(JSON.stringify(policy)),
      ".gitignore": GITIGNORE,
    });
    const py = syncedPy(repo);
    if (py === null) return ctx.skip("uv's Python 3.13 is absent");
    const names = ["a", "b", "c", "d"];
    for (const n of names) writeFileSync(join(py, "tests", `test_slot_${n}.py`), slotTest(out, n));

    const first = suite.daemon(repo);
    await waitReady(repo, first);
    // Run in one foreground checkpoint so host load cannot throttle backlog concurrency to 1.
    const ran = await cli(repo, "run", "--fast", "--wait");
    expect(ran.code, ran.out).toBe(0);
    const settled = await settle(repo, "4 slot files pass", (s) => passes(s) === 8);
    expect(settled.knownFailures).toEqual([]);
    const seen = readdirSync(out).map((f) => JSON.parse(readFileSync(join(out, f), "utf8")));
    expect(seen).toHaveLength(4);
    for (const s of seen) {
      expect(["1", "2"]).toContain(s.SQUEAL_SLOT);
      expect(s.SQUEAL_WORKTREE_SLOT).toMatch(new RegExp(`^[0-9a-f]{8}_${s.SQUEAL_SLOT}$`));
      expect(s.TOX_PARALLEL_ENV).toBe(s.SQUEAL_WORKTREE_SLOT);
      expect(s.REDIS_CONNECTION).toBe(`redis://redis:6379/${s.SQUEAL_SLOT}`);
      expect(JSON.parse(s.DB_CONNECTION)).toEqual({
        dbname: `workers_test_${s.SQUEAL_WORKTREE_SLOT}`,
        port: 5432,
      });
      expect(s.SLOT0).toBe(String(Number(s.SQUEAL_SLOT) - 1));
      expect(s.LITERAL).toBe("{unknown}");
    }
    // `slots.max` 2: never two overlapping batches in one slot, never a third slot.
    for (const a of seen) {
      for (const b of seen) {
        if (a === b || a.SQUEAL_SLOT !== b.SQUEAL_SLOT) continue;
        expect(a.end <= b.start || b.end <= a.start).toBe(true);
      }
    }
    expect(seen.some((a) => seen.some((b) => a.start < b.end && b.start < a.end && a !== b))).toBe(
      true,
    );

    // A second daemon keys every file as the first did, whatever slot it ran in: none runs again.
    expect((await cli(repo, "stop")).code).toBe(0);
    await first.exited;
    const second = suite.daemon(repo);
    await waitReady(repo, second);
    await settle(repo, "still current", (s) => passes(s) === 8);
    expect((await cli(repo, "status", "--wait", "30000")).out).toContain("Returned on quiet");
    expect(readdirSync(out)).toHaveLength(4);
  });

  it("admits an empty build-stage editable and refuses one with code outside", async (ctx) => {
    const repo = suite.fixture({
      "squeal.config.json": runMissingConfig(
        JSON.stringify({
          checks: MANUAL_VITEST,
          pytest: [{ name: "py", cwd: "py", include: ["tests/test_plain.py"] }],
        }),
      ),
      ".gitignore": GITIGNORE,
    });
    const py = syncedPy(repo);
    if (py === null) return ctx.skip("uv's Python 3.13 is absent");
    writeFileSync(join(py, "tests", "test_plain.py"), "def test_plain():\n    assert True\n");
    // A container build stage's /pkgs: project metadata and a .venv, no Python code.
    const pkgs = outside("sq-pkgs-");
    writeFileSync(join(pkgs, "pyproject.toml"), '[project]\nname = "stage"\n');
    writeFileSync(join(pkgs, "uv.lock"), "");
    const site = readdirSync(join(py, ".venv", "lib"))[0] as string;
    const sitePackages = join(py, ".venv", "lib", site, "site-packages");
    const distInfo = join(sitePackages, "stage-0.0.0.dist-info");
    mkdirSync(distInfo);
    writeFileSync(
      join(distInfo, "direct_url.json"),
      JSON.stringify({ url: `file://${pkgs}`, dir_info: { editable: true } }),
    );
    writeFileSync(join(sitePackages, "_stage.pth"), `${pkgs}\n`);
    writeFileSync(join(distInfo, "RECORD"), "_stage.pth,,\nstage-0.0.0.dist-info/RECORD,,\n");
    const spawned = suite.daemon(repo);
    await waitReady(repo, spawned);
    await settle(repo, "the empty editable is admitted", (s) => passes(s) === 2);

    // The same editable with a module in it: refused, with its note, and nothing runs.
    writeFileSync(join(pkgs, "stage.py"), "VALUE = 1\n");
    expect((await cli(repo, "stop")).code).toBe(0);
    await spawned.exited;
    const again = suite.daemon(repo);
    await waitReady(repo, again);
    const refused = await settle(repo, "the code editable is refused", (s) =>
      notesOf(s).includes("editable, outside this worktree"),
    );
    expect(notesOf(refused)).toContain(`"stage" from ${pkgs}`);
  });
});

/** A `docker` first on `PATH` that logs each call to `log` and fails. */
function fakeDocker(repo: FixtureRepo, log: string): FixtureRepo {
  const bin = outside("sq-fake-docker-");
  writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 1\n`);
  chmodSync(join(bin, "docker"), 0o755);
  return { ...repo, env: { ...repo.env, PATH: `${bin}:${repo.env.PATH ?? ""}` } };
}

/**
 * The node:test policy key. These projects run only on the container
 * image's Node or not at all, never on the host's, so the host's Node
 * version does not select this file (`test/version-sensitive.txt`).
 */
const NODE = ["node", "Test"].join("") as `node${"Test"}`;

const CT_TEST = `const { test } = require("node:test");
const { writeFileSync } = require("node:fs");
test("runs in its container", () => {
  writeFileSync(__dirname + "/ran-in-container.txt", require("node:os").hostname());
});
`;

describe("spec 027 stage 2 end to end, no Docker (row 027-07)", { timeout: 300_000 }, () => {
  it("runs no docker command without consent, says why, and clears Containers: when removed", async () => {
    const config = (container: boolean) =>
      `${JSON.stringify({
        checks: MANUAL_VITEST,
        containers: { node: { image: "squeal-test/never-built:027" } },
        [NODE]: [
          {
            name: "ct",
            cwd: "ct",
            include: ["*.test.cjs"],
            ...(container ? { container: "node" } : {}),
          },
        ],
      })}\n`;
    const log = join(outside("sq-docker-log-"), "calls");
    const repo = fakeDocker(
      suite.fixture({ "squeal.config.json": config(true), "ct/a.test.cjs": CT_TEST }),
      log,
    );
    const spawned = suite.daemon(repo);
    await waitReady(repo, spawned);
    const s = await settle(repo, "unconsented", (x) => x.containers !== undefined);
    expect(s.containers).toBe("container node (unconsented, build-content)");
    expect(notesOf(s)).toMatch(/squeal setup/);
    const status = await cli(repo, "status");
    expect(status.out).toContain("Containers: container node (unconsented, build-content)");
    expect(existsSync(join(repo.root, "ct", "ran-in-container.txt"))).toBe(false);
    expect(existsSync(log)).toBe(false);

    // Review 0.1.644 N1: the project leaves its container, and the line goes.
    writeFileSync(join(repo.root, "squeal.config.json"), config(false));
    await settle(repo, "Containers: cleared", (x) => x.containers === undefined);
    expect((await cli(repo, "status")).out).not.toContain("Containers:");
    expect(existsSync(log)).toBe(false);
  });
});

const docker = (...args: string[]) =>
  spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
const DOCKER = docker("info", "--format", "{{.ServerVersion}}").status === 0;
const imageId = (ref: string) => {
  const r = docker("image", "inspect", "--format", "{{.Id}}", "--", ref);
  return r.status === 0 ? r.stdout.trim() : null;
};

/**
 * An already-local image with Node 22.19 or later: `SQUEAL_TEST_NODE_IMAGE`,
 * else one whose `NODE_VERSION` says so. Never pulled.
 */
function localNodeImage(): string | undefined {
  if (!DOCKER) return undefined;
  const named = process.env.SQUEAL_TEST_NODE_IMAGE;
  if (named !== undefined && named !== "") return imageId(named) === null ? undefined : named;
  const listed = docker("images", "--format", "{{.Repository}}:{{.Tag}}");
  return listed.stdout
    .split("\n")
    .filter((ref) => ref !== "" && !ref.includes("<none>"))
    .find((ref) => {
      const env = docker("image", "inspect", "--format", "{{json .Config.Env}}", "--", ref);
      const found = /"NODE_VERSION=v?(\d+)\.(\d+)/.exec(env.stdout);
      const [major, minor] = [Number(found?.[1]), Number(found?.[2])];
      return found !== null && (major > 22 || (major === 22 && minor >= 19));
    });
}
const NODE_IMAGE = localNodeImage();
/** A local image with a shell and no Node, for the refusal. */
const NO_NODE = DOCKER
  ? ["debian:bookworm-slim", "ubuntu:24.04"].find((ref) => imageId(ref) !== null)
  : undefined;

/** Managed containers of `worktreeId`, running or not; of one managed target when named. */
function managed(worktreeId: string, target?: string): string[] {
  const of = target === undefined ? [] : ["--filter", `label=${LABELS.target}=${target}`];
  const out = docker("ps", "-aq", "--filter", `label=${LABELS.worktree}=${worktreeId}`, ...of);
  return out.stdout.split("\n").filter((l) => l !== "");
}

/** Paths under `root` the host user does not own. */
function foreignOwned(root: string): string[] {
  const uid = process.getuid?.() ?? -1;
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (statSync(path).uid !== uid) found.push(path);
      if (entry.isDirectory() && entry.name !== ".git") walk(path);
    }
  };
  walk(root);
  return found;
}

describe.skipIf(NODE_IMAGE === undefined || NO_NODE === undefined)(
  "spec 027 stage 2 on the host's Docker (row 027-07)",
  { timeout: 600_000 },
  () => {
    it("runs in its managed container, refuses an image without Node, reaps an orphan and leaves nothing", async () => {
      const repo = suite.fixture({
        "squeal.config.json": runMissingConfig(
          JSON.stringify({
            checks: MANUAL_VITEST,
            containers: {
              node: { image: NODE_IMAGE, network: "none" },
              bare: { image: NO_NODE, network: "none", keyMode: "image-id" },
            },
            [NODE]: [
              { name: "ct", cwd: "ct", include: ["*.test.cjs"], container: "node" },
              { name: "old", cwd: "old", include: ["*.test.cjs"], container: "bare" },
            ],
          }),
        ),
        "ct/a.test.cjs": CT_TEST,
        "old/a.test.cjs": CT_TEST,
      });
      onTestFinished(() => {
        const left = managed(repo.worktreeId);
        if (left.length > 0) docker("rm", "-f", ...left);
      });
      const consent = containerConsentPath(repo.env);
      mkdirSync(dirname(consent), { recursive: true });
      writeFileSync(
        consent,
        JSON.stringify({ allow: { [repo.root]: { enabled: true, targets: "all" } } }),
      );
      const first = suite.daemon(repo);
      await waitReady(repo, first);
      const ready = await settle(
        repo,
        "ct passes in its container",
        (s) =>
          s.containers ===
            "container bare (node-too-old, image-id); container node (ready, build-content)" &&
          existsSync(join(repo.root, "ct", "ran-in-container.txt")),
      );
      expect(notesOf(ready)).toMatch(/22\.19/);
      // The test ran on the live mount, as the host user, in a container: its hostname is not ours.
      const ran = join(repo.root, "ct", "ran-in-container.txt");
      expect(readFileSync(ran, "utf8")).not.toBe(execFileSync("hostname").toString().trim());
      expect(existsSync(join(repo.root, "old", "ran-in-container.txt"))).toBe(false);
      // The ct project's own container (`managedName`: target, runner, project).
      const [container] = managed(repo.worktreeId, "node.node-test.ct");
      expect(container).toBeDefined();
      expect((await cli(repo, "ps")).out).toMatch(/squeal-ct-/);

      // A daemon killed outright leaves its container; the next daemon reaps it.
      first.child.kill("SIGKILL");
      await first.exited;
      expect(managed(repo.worktreeId)).toContain(container);
      const second = suite.daemon(repo);
      await waitReady(repo, second);
      await settle(
        repo,
        "the orphan is reaped",
        () => !managed(repo.worktreeId).includes(container as string),
      );

      expect((await cli(repo, "stop")).code).toBe(0);
      await second.exited;
      await settle(repo, "zero managed containers", () => managed(repo.worktreeId).length === 0);
      expect(foreignOwned(repo.root)).toEqual([]);
    });
  },
);
