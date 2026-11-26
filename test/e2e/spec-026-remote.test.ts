import { appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { treeDir } from "../../src/core/runner-host/remote/connect.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  readNotes,
  stopProcess,
  withStore,
} from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { mockAgent37Api } from "../runner-host/remote/providers/agent37-api-mock.js";
import {
  agent37WorldMissing,
  certificates,
  routingProxy,
  sshBridge,
  startSshd,
  TUNNEL_TEMPLATE,
} from "./spec-026-agent37-world.js";
import { buildPluginDist } from "./spec-026-build.js";
import {
  cliIn,
  commandLane,
  nodeWith,
  OTHER_ARCH,
  pytestPython,
  remoteFixture,
  SLOW_DISK,
  sampleLocalHosts,
  served as servedIn,
} from "./spec-026-remote-fixture.js";

/*
 * Spec 026 row 026-16, Track 2 end to end, with the plugin's bundled CLI
 * built from this worktree (`spec-026-build.ts`) as the daemon, and a
 * remote that is a directory of this machine behind a fake `ssh`
 * (`spec-026-remote-fixture.ts`). The `command` provider's own scripts
 * acquire, sleep, wake and release it; `squeal remote list|sleep|prune`
 * reach it. Hybrid 2A: every lane (background baseline, edit, slow,
 * group) and runner (Vitest, node:test, pytest when this machine has it)
 * runs there with remote planning, and no local runner host ever starts;
 * the remote's coverage lands in the local code store. A remote Node that
 * reports another arch is refused under `match-local` and keyed to its own
 * environment under `remote-key` (D10); one whose disk syncs slowly is
 * named and kept under `warn` and refused under `refuse` (D11). The
 * `agent37` provider runs against a local Agent37: the row 026-15 mock
 * API, a `CONNECT` proxy and a TLS WebSocket bridge to a loopback `sshd`
 * (`spec-026-agent37-world.ts`), so a real `ssh` goes through
 * `squeal remote-tunnel agent37`.
 */

const suite = daemonSuite({}, buildPluginDist);

const MATH = { project: "", path: "test/math.test.ts" } as TestFileRef;
const PYTHON = pytestPython();
const fixture = (extra?: Record<string, unknown>, files?: Record<string, string>) =>
  remoteFixture(suite, extra, files);
const lane = commandLane;
const served = (repo: FixtureRepo) => servedIn(suite, repo);
const cli = (repo: FixtureRepo, ...args: string[]) => cliIn(suite, repo, ...args);

/** The lifecycle cases' disk check: warn, at a limit a slow sandbox disk (25 to 52 ms/sync) stays under. */
const LIFECYCLE_DISK = { maxWriteMs: 5_000, onSlowDisk: "warn" } as const;

describe("spec 026 Track 2 end to end (row 026-16)", { timeout: 600_000 }, () => {
  it("runs every lane and runner on a command machine, with 0 local hosts, through its lifecycle", async () => {
    const world = fixture();
    const { repo } = world;
    // Review 0.1.623 S1: a limit no sandbox disk reaches, so the `awake` below does not depend
    // on the host's disk speed; the slow-disk case keeps its strict 10 ms limit.
    const hooks = lane(world, process.execPath, { diskCheck: LIFECYCLE_DISK });
    const sampler = sampleLocalHosts(repo.root);
    const spawned = await served(repo);
    const why = () => diagnose(repo, spawned);

    // Background: the start baseline runs every file there, the slow one included.
    const start = await cli(repo, "status", "--wait", "120000");
    expect(start.code, `${start.out}\n${why()}`).toBe(0);
    // Edit: the edit's file runs there.
    appendFileSync(
      join(repo.root, "src/math.ts"),
      "\nexport const twice = (a: number) => a * 2;\n",
    );
    const edit = await cli(repo, "status", "--wait", "120000", "src/math.ts");
    expect(edit.out, why()).toContain("Selected: test/math.test.ts");
    expect(edit.out).toMatch(/no known failures; 1 test file, each with a current result/);
    // Group: the manual group runs there on request.
    const group = await cli(repo, "run", "later", "--wait", "120000");
    expect(group.out, why()).toMatch(/^Group later completed at revision \d+: no known failures/);
    // Review 0.1.622 B2: wait for remaining baseline/slow work (or any tier
    // the edit cancelled and requeued) before asserting all 6 files current and reading coverage.
    const settled = await cli(repo, "run", "--all", "--wait", "120000");
    expect(settled.code, `${settled.out}\n${why()}`).toBe(0);
    // Row 026-20 (D12.1): plain status names the remote, its state, lanes, runners and proof.
    expect((await cli(repo, "status")).out, why()).toMatch(
      /^Remote: command cmd:lan-1: awake; background, edit, slow and group runs of vitest, node-test, pytest, jest; planning remote; environment match-local; proven at \d{4}-\d\d-\d\dT[\d:.]+Z$/m,
    );
    const full = await cli(repo, "status", "--full");
    expect(full.out, why()).toMatch(/Known failures: 0; all 6 test files current/);
    const notes = readNotes(repo).join("\n");
    expect(notes).toMatch(/remote command: background and edit runs of vitest go there; proven/);
    expect(notes).toMatch(/remote command: group runs of vitest go there; proven/);
    expect(notes).toMatch(
      /remote command: background, edit, slow and group runs of node-test go there; proven/,
    );
    // D9: the remote's coverage is in the local code store.
    const code = await cli(repo, "code", "src/strings.ts");
    expect(code.out).toMatch(
      /upper +CC 1, at or under; CRAP 1; 100% of its lines ran in 2 test files/,
    );

    // D12: list and sleep; the next edit wakes it and runs there.
    const list = await cli(repo, "remote", "list");
    expect(list.out).toMatch(new RegExp(`cmd:lan-1 +command +awake +${repo.root}`));
    const slept = await cli(repo, "remote", "sleep", repo.root);
    expect({ code: slept.code, stdout: slept.stdout }).toEqual({
      code: 0,
      stdout: "cmd:lan-1: asked to sleep\n",
    });
    appendFileSync(
      join(repo.root, "src/strings.ts"),
      "\nexport const lower = (s: string) => s.toLowerCase();\n",
    );
    const woke = await cli(repo, "status", "--wait", "120000", "src/strings.ts");
    expect(woke.out, why()).toMatch(/no known failures; 2 test files, each with a current result/);

    // Daemon exit releases it as such; a removed worktree's machine is pruned.
    await stopProcess(spawned);
    expect(sampler.stop(), "local runner hosts seen at once").toBe(0);
    expect(hooks.calls()).toEqual(["acquire", "sleep", "wake", "release daemon-exit"]);
    renameSync(repo.root, `${repo.root}-gone`);
    try {
      const pruned = await cli({ ...repo, root: repo.runtimeDir }, "remote", "prune");
      expect({ code: pruned.code, stdout: pruned.stdout }).toEqual({
        code: 0,
        stdout: `released cmd:lan-1 (command) of removed worktree ${repo.root}\n`,
      });
    } finally {
      renameSync(`${repo.root}-gone`, repo.root);
    }
    expect(hooks.calls().at(-1)).toBe("release worktree-removed");
    expect((await cli({ ...repo, root: repo.runtimeDir }, "remote", "list")).out).not.toContain(
      "cmd:lan-1",
    );
  });

  it.skipIf(PYTHON === null)("runs pytest files there too", async () => {
    const world = fixture(
      { pytest: [{ name: "py", python: PYTHON, include: ["py/test_*.py"] }] },
      { "py/test_add.py": "def test_add():\n    assert 1 + 1 == 2\n" },
    );
    lane(world);
    const sampler = sampleLocalHosts(world.repo.root);
    const spawned = await served(world.repo);
    const status = await cli(world.repo, "status", "--wait", "120000", "py/test_add.py");
    expect(status.out, diagnose(world.repo, spawned)).toMatch(/each with a current result/);
    expect(readNotes(world.repo).join("\n")).toMatch(/runs of pytest go there; proven/);
    expect(sampler.stop()).toBe(0);
  });

  it("names a slow disk and keeps the machine under warn, and refuses it under refuse", async () => {
    const warned = fixture();
    lane(warned, nodeWith(join(warned.repo.runtimeDir, "slow-node"), SLOW_DISK), {
      diskCheck: { maxWriteMs: 10, onSlowDisk: "warn" },
    });
    const warnDaemon = await served(warned.repo);
    const all = await cli(warned.repo, "run", "--all", "--wait", "120000");
    expect(all.code, `${all.out}\n${diagnose(warned.repo, warnDaemon)}`).toBe(0);
    const warnNotes = readNotes(warned.repo).join("\n");
    expect(warnNotes).toMatch(
      /remote cmd:lan-1: degraded disk: \d+ ms\/sync, limit 10 ms; runs go there anyway \(onSlowDisk "warn"\)/,
    );
    expect(warnNotes).toMatch(
      /remote command: background and edit runs of vitest go there; proven/,
    );
    await stopProcess(warnDaemon);

    const refused = fixture();
    lane(refused, nodeWith(join(refused.repo.runtimeDir, "slow-node"), SLOW_DISK), {
      diskCheck: { maxWriteMs: 10, onSlowDisk: "refuse" },
    });
    const sampler = sampleLocalHosts(refused.repo.root);
    const refuseDaemon = await served(refused.repo);
    await cli(refused.repo, "status", "--wait", "30000");
    const refuseNotes = readNotes(refused.repo).join("\n");
    expect(refuseNotes, diagnose(refused.repo, refuseDaemon)).toMatch(
      /remote cmd:lan-1: degraded disk: \d+ ms\/sync, limit 10 ms; refused \(onSlowDisk "refuse"\)/,
    );
    expect(refuseNotes).toMatch(/not planned here \(whenLost "not-run"\)/);
    expect(refuseNotes).not.toMatch(/go there; proven/);
    // Row 026-20 (lessons D1, D12.1): no empty, completed checkpoint; the refusal is named.
    refusedHonestly(
      (await cli(refused.repo, "status")).out,
      "degraded disk: \\d+ ms\\/sync, limit 10 ms",
    );
    // Refused under `not-run`: nothing ran here either.
    expect(sampler.stop()).toBe(0);
    const results = withStore(refused.repo, (store) =>
      store.testFileKeys.list(refused.repo.worktreeId),
    );
    expect(results).toEqual([]);
  });

  it("refuses another arch under match-local, and under remote-key keys results to it apart from local ones", async () => {
    const matched = fixture();
    lane(matched, nodeWith(join(matched.repo.runtimeDir, "other-node"), OTHER_ARCH));
    const matchDaemon = await served(matched.repo);
    await cli(matched.repo, "status", "--wait", "30000");
    const matchNotes = readNotes(matched.repo).join("\n");
    expect(matchNotes, diagnose(matched.repo, matchDaemon)).toContain(
      `remote command refused: arch riscv64 on the remote, ${process.arch} here`,
    );
    expect(matchNotes).not.toMatch(/go there; proven/);
    refusedHonestly(
      (await cli(matched.repo, "status")).out,
      `arch riscv64 on the remote, ${process.arch} here`,
    );
    await stopProcess(matchDaemon);

    const keyed = fixture();
    const { repo } = keyed;
    lane(keyed, nodeWith(join(repo.runtimeDir, "other-node"), OTHER_ARCH), {
      environmentMode: "remote-key",
    });
    const sampler = sampleLocalHosts(repo.root);
    const keyDaemon = await served(repo);
    const all = await cli(repo, "run", "--all", "--wait", "120000");
    expect(all.code, `${all.out}\n${diagnose(repo, keyDaemon)}`).toBe(0);
    const machine = `${process.platform}/riscv64, Node v`;
    expect(readNotes(repo).join("\n")).toContain(`remote command (${machine}`);
    expect(readNotes(repo).join("\n")).toMatch(/results keyed to remote environment; proven/);
    expect((await cli(repo, "status")).out).toContain(`; environment remote-key (${machine}`);
    await stopProcess(keyDaemon);
    expect(sampler.stop()).toBe(0);
    const keyOf = () =>
      withStore(repo, (store) => store.testFileKeys.list(repo.worktreeId, [MATH])[0]?.key ?? null);
    const remoteKey = keyOf();
    expect(remoteKey).not.toBeNull();

    // Without the remote, the same file at the same content runs here under its own key;
    // the remote's result stays under the remote's key and is never taken for this one.
    keyed.remote(null);
    const localDaemon = await served(repo);
    const here = await cli(repo, "status", "--wait", "120000", MATH.path);
    expect(here.out, diagnose(repo, localDaemon)).toMatch(
      /1 test file, each with a current result/,
    );
    const localKey = keyOf();
    expect(localKey).not.toBeNull();
    expect(localKey).not.toBe(remoteKey);
    withStore(repo, (store) => {
      expect(store.results.byKey(remoteKey).length).toBeGreaterThan(0);
      expect(store.results.byKey(localKey).length).toBeGreaterThan(0);
    });
  });
});

const AGENT37_MISSING = agent37WorldMissing();
const KEY = "sk_e2e_agent37_0b7e";
const GIT_TEST = [
  'import { execFileSync } from "node:child_process";',
  'import { expect, it } from "vitest";',
  'it("reads HEAD", () => {',
  '  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })).toMatch(/^[0-9a-f]{40}\\n$/);',
  "});",
  "",
].join("\n");

describe.skipIf(AGENT37_MISSING !== undefined)(
  "spec 026 Track 2 end to end on a mock Agent37 (row 026-16)",
  { timeout: 600_000 },
  () => {
    it("creates, bootstraps Git, runs a needsRepository file there, sleeps, wakes, is reused and deleted", async () => {
      const world = fixture(
        { remote: { needsRepository: ["test/git.test.ts"] } },
        { "test/git.test.ts": GIT_TEST },
      );
      const { repo } = world;
      const dir = join(repo.runtimeDir, "agent37");
      const certs = certificates(join(dir, "certs"));
      const sshd = await startSshd(join(dir, "sshd"), world.home);
      const bridge = await sshBridge(certs, KEY, () => sshd.port);
      const proxy = await routingProxy(() => bridge.port);
      const api = await mockAgent37Api(certs);
      onTestFinished(async () => {
        await Promise.all([api.close(), proxy.close(), bridge.close()]);
        sshd.stop();
      });
      for (const name of ["NO_PROXY", "no_proxy", "https_proxy", "http_proxy", "HTTP_PROXY"]) {
        delete repo.env[name];
      }
      Object.assign(repo.env, {
        PATH: `${sshd.bin}:${repo.env.PATH ?? ""}`,
        HTTPS_PROXY: proxy.url,
        NODE_EXTRA_CA_CERTS: certs.caFile,
        AGENT37_API_KEY: KEY,
      });
      const places = { node: process.execPath, cache: ".squeal-remote" };
      world.remote({
        provider: "agent37",
        providerConfig: {
          apiBaseUrl: api.url,
          sshKeyPath: sshd.key,
          tunnelHostTemplate: TUNNEL_TEMPLATE,
          ...places,
        },
        lanes: "all",
        runners: "all",
        whenLost: "not-run",
        // Review 0.1.623 S1: as the command lifecycle's.
        diskCheck: LIFECYCLE_DISK,
      });
      const sampler = sampleLocalHosts(repo.root);
      let spawned = await served(repo);
      const why = () => diagnose(repo, spawned);

      // Create, Node, `.git` from a local bundle, then every file there: the Git one too.
      const all = await cli(repo, "run", "--all", "--wait", "180000");
      expect(all.code, `${all.out}\n${why()}`).toBe(0);
      const [id] = [...api.instances.keys()];
      const plain = (await cli(repo, "status")).out;
      expect(plain).toMatch(/Known failures: 0; all 7 test files current/);
      // Row 026-20 (D12.1, D12.2): status names the instance awake; ps names its remote hosts so.
      expect(plain).toMatch(
        new RegExp(`^Remote: agent37 agent37:eu:vm:${id}: awake; .*; planning remote; `, "m"),
      );
      const ps = (await cli(repo, "ps", "--repo")).out;
      expect(ps, ps).toMatch(
        new RegExp(`^ +host vitest +\\d+ +remote agent37 .* agent37:eu:vm:${id}, awake$`, "m"),
      );
      expect(spawned.stderr()).toContain(`Agent37 instance ${id} created (eu vm, agent37-base)`);
      expect(spawned.stderr()).toMatch(new RegExp(`Agent37 instance ${id}: git history sent at`));
      const created = api.calls.find((c) => c.method === "POST" && c.path === "/v1/instances");
      expect(created?.body).toMatchObject({
        region: "eu",
        type: "vm",
        resources: { cpu: 4, memory: 8, disk: 10 },
        auto_sleep: true,
        idle_timeout_seconds: 600,
      });
      expect(new Set(api.calls.map((c) => c.authorization))).toEqual(new Set([`Bearer ${KEY}`]));
      const remoteRoot = join(world.home, treeDir(places, repo.root as never), "root");
      expect(git(remoteRoot, ["rev-parse", "HEAD"])).toBe(git(repo.root, ["rev-parse", "HEAD"]));
      // The API and SSH both went through the proxy; the tunnel carried the key.
      expect(proxy.targets).toContain(`${id}.squeal.test:443`);
      expect(proxy.targets).toContain(new URL(api.url).host);
      expect(new Set(bridge.keys)).toEqual(new Set([KEY]));

      // Sleep, then the next edit wakes it and runs there.
      await cli(repo, "remote", "sleep", repo.root);
      expect(api.instances.get(id as string)).toBe("sleeping");
      appendFileSync(
        join(repo.root, "src/math.ts"),
        "\nexport const twice = (a: number) => a * 2;\n",
      );
      const woke = await cli(repo, "status", "--wait", "180000", "src/math.ts");
      expect(woke.out, why()).toMatch(/1 test file, each with a current result/);
      expect(api.instances.get(id as string)).toBe("running");
      expect(api.calls.some((c) => c.path === `/v1/instances/${id}/start`)).toBe(true);

      // Daemon exit sleeps it; the next daemon reuses it.
      await stopProcess(spawned);
      expect(api.instances.get(id as string)).toBe("sleeping");
      spawned = await served(repo);
      const again = await cli(repo, "run", "--all", "--wait", "180000");
      expect(again.code, `${again.out}\n${why()}`).toBe(0);
      expect(spawned.stderr()).toContain(`Agent37 instance ${id} reused (sleeping before)`);
      expect(
        api.calls.filter((c) => c.method === "POST" && c.path === "/v1/instances"),
      ).toHaveLength(1);
      await stopProcess(spawned);
      expect(sampler.stop(), "local runner hosts seen at once").toBe(0);

      // A removed worktree's instance is deleted.
      renameSync(repo.root, `${repo.root}-gone`);
      try {
        await cli({ ...repo, root: repo.runtimeDir }, "remote", "prune");
      } finally {
        renameSync(`${repo.root}-gone`, repo.root);
      }
      expect(api.calls.at(-1)).toMatchObject({ method: "DELETE", path: `/v1/instances/${id}` });
      expect(api.instances.size).toBe(0);
    });
  },
);

/**
 * Row 026-20 (lessons D1, spec 026 D12.1): plain status of a remote refused
 * under `whenLost: "not-run"` says the listing failed and why, names no
 * completed or empty checkpoint, and its `Remote:` line names the refusal.
 */
function refusedHonestly(out: string, reason: string): void {
  expect(out).not.toContain("the daemon listed no test files");
  expect(out).not.toContain("Full-suite checkpoint: completed at revision 0");
  expect(out).toMatch(
    new RegExp(
      `^The daemon could not list this worktree's test files: remote command refused: ${reason}; not planned here \\(whenLost "not-run"\\)\\.`,
      "m",
    ),
  );
  expect(out).toContain("Full-suite checkpoint: none completed at any revision");
  expect(out).toMatch(
    new RegExp(
      `^Remote: command cmd:lan-1: refused \\(${reason}\\); background, edit, slow and group runs of vitest, node-test, pytest, jest; planning remote; environment match-local$`,
      "m",
    ),
  );
}
