import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { coverageProvider } from "../../src/core/code/coverage/runtime.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { spawnRunnerHost } from "../../src/core/runner-host/channel.js";
import type { HostAdapterOptions, HostPolicy } from "../../src/core/runner-host/protocol.js";
import { startHostProxy } from "../../src/core/runner-host/proxy.js";
import { startRemoteHost, treeDir } from "../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../src/core/runner-host/remote/lane.js";
import type { WhenLost } from "../../src/core/runner-host/remote/settings.js";
import type { RunnerAdapter, RunOptions } from "../../src/core/types/runner.js";
import { buildBundle, gitFixture } from "../runner-host/remote/helpers.js";
import { dockerUnavailable, REMOTE_CACHE, type Remote, startRemote } from "./remote-container.js";

/*
 * Spec 021 Testing, Part 3 (row 021-14): a background run on a container
 * over the real `ssh`, through the lane the daemon builds. A tree that
 * differs is refused, sent again and retried; a different Node is refused;
 * a paused container ends its run `unknown` within its deadline under
 * `not-run`; under `local` a killed host's files run here in the same call.
 * Both sides take the daemon's default, coverage on; the remote runs without
 * it (D12), and its runs are still proven (row 021-22). Row 021-23 (D19): a
 * command the tests need, missing there, refuses the remote; a
 * `needsRepository` file never runs there; a remote "not a git repository"
 * failure is not kept, and its file runs here. The container's `git` is a
 * fake that answers as Git does outside a repository and logs each call.
 */

const unavailable = dockerUnavailable();
const LONG = { timeout: 600_000 } as const;
const MATH = { project: "", path: "test/math.test.ts" };
const SLOW = { project: "", path: "test/slow.test.ts" };
const GIT = { project: "", path: "test/git.test.ts" };
/** Where the container's fake `git` logs its calls. */
const GIT_CALLS = "/tmp/git-calls";
/** The policy both sides take, the daemon's default: the recorder and coverage on (the remote turns coverage off, D12). */
const POLICY: HostPolicy = {
  observe: true,
  exclude: [],
  excludeProjects: [],
  coverage: true,
  coverageChildren: false,
};

/** This process's env with only what a local host needs: no CI variable of any provider. */
function withoutCi(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG"] as const;
  return Object.fromEntries(
    keep.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/** A Node that says it is another version: what a remote with another Node install reports. */
const OTHER_NODE = "/opt/other-node/node";

describe.skipIf(unavailable !== undefined)("a remote lane on a container over ssh", () => {
  let remote: Remote;
  let cli = "";
  const scratch = mkdtempSync(join(tmpdir(), "squeal-e2e-lane-"));
  beforeAll(async () => {
    cli = await buildBundle(join(scratch, "dist"));
    remote = startRemote();
    remote.exec(
      [
        "mkdir -p /opt/other-node",
        `printf '%s\\n' 'Object.defineProperty(process, "version", { value: "v0.0.1-other" });' > /opt/other-node/version.mjs`,
        `printf '#!/bin/sh\\nexec /opt/node/bin/node --import /opt/other-node/version.mjs "$@"\\n' > ${OTHER_NODE}`,
        `chmod +x ${OTHER_NODE}`,
        `printf '#!/bin/sh\necho "$*" >> ${GIT_CALLS}\necho "fatal: not a git repository (or any of the parent directories): .git" >&2\nexit 128\n' > /usr/local/bin/git`,
        "chmod +x /usr/local/bin/git",
      ].join(" && "),
    );
  }, LONG.timeout);
  afterAll(() => {
    remote?.stop();
    rmSync(scratch, { recursive: true, force: true });
  });

  async function lane(
    whenLost: WhenLost = "local",
    node = "/opt/node/bin/node",
    needs: { readonly commands?: string[]; readonly needsRepository?: string[] } = {},
  ) {
    const root = gitFixture("basic", {
      ".gitignore": ".squeal-logs/\n",
      "test/slow.test.ts":
        'import { it } from "vitest";\nit("waits", async () => { await new Promise((r) => setTimeout(r, 6000)); });\n',
      "test/git.test.ts":
        'import { execFileSync } from "node:child_process";\nimport { expect, it } from "vitest";\nit("reads HEAD", () => {\n  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })).toMatch(/^[0-9a-f]{40}\\n$/);\n});\n',
    });
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
    git("add", "-A");
    git(
      "-c",
      "user.name=squeal",
      "-c",
      "user.email=squeal@example.com",
      "commit",
      "-qm",
      "fixture",
    );
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const provider = coverageProvider();
    if (provider === null) throw new Error("no coverage provider beside the sources");
    const options: HostAdapterOptions = {
      childEnv: {},
      coverage: { provider, tempDir: join(scratch, "coverage") },
    };
    // Here Vitest runs in a local runner host, as the daemon runs it (spec 021 D8), with the
    // daemon's options and an env without CI variables, as the remote's ssh login has none. In
    // this test process Vitest read CI when it loaded (std-env), and GitHub's runners set CI=true:
    // a config resolved for CI (allowOnly, browser) differs, and the lane rightly refuses (D11).
    const local = await startHostProxy({
      channel: spawnRunnerHost(
        { execPath: process.execPath, execArgv: [], cli },
        root,
        "vitest",
        withoutCi(),
      ),
      runner: "vitest",
      version: squealVersion(),
      options,
      policy: () => POLICY,
    });
    const statuses: string[] = [];
    const logs: string[] = [];
    const repository: string[] = [];
    const places = { node, cache: REMOTE_CACHE };
    const adapter: RunnerAdapter = withRemoteLane({
      target: remote.destination,
      whenLost,
      root,
      version: squealVersion(),
      local,
      connect: () =>
        startRemoteHost({
          target: { destination: remote.destination, ssh: remote.ssh },
          places,
          launch: { execPath: process.execPath, execArgv: [], cli },
          version: squealVersion(),
          root,
          runner: "vitest",
          options,
          policy: () => POLICY,
          deadlines: { aliveMs: 3_000 },
          ...(needs.commands === undefined ? {} : { commands: needs.commands }),
        }),
      allowlist: () => [],
      ...(needs.needsRepository === undefined
        ? {}
        : { needsRepository: () => needs.needsRepository ?? [] }),
      repository: (text) => repository.push(text),
      status: (text) => statuses.push(text),
      log: (text) => logs.push(text),
    });
    onTestFinished(() => adapter.close());
    const settled = () => statuses.some((s) => / go there| refused| unreachable/.test(s));
    for (let i = 0; i < 600 && !settled(); i++) await new Promise((r) => setTimeout(r, 50));
    return { adapter, root, statuses, logs, repository, tree: `${treeDir(places, root)}/root` };
  }

  const background = (root: string): RunOptions => ({
    runId: randomUUID(),
    logDir: join(root, ".squeal-logs", randomUUID()),
    timeoutMs: 60_000,
    background: true,
    workers: 1,
    lane: "vitest",
  });

  it(
    "refuses a tree that differs, sends the file again, and keeps the retry's proven result",
    LONG,
    async () => {
      const { adapter, root, logs, statuses, tree } = await lane();
      remote.exec(`echo "export const drift = 1;" >> ${tree}/src/math.ts`);
      const report = await adapter.run([MATH], background(root));
      expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
      expect(logs).toContain(
        `remote ${remote.destination}: tree differs at src/math.ts; sending again`,
      );
      expect(statuses.at(-1)).toMatch(/background runs of vitest go there; proven at/);
      expect(remote.exec(`grep -c drift ${tree}/src/math.ts || true`)).toBe("0\n");
    },
  );

  it("refuses a remote whose Node differs, names both versions, and runs here", LONG, async () => {
    const { adapter, root, statuses } = await lane("local", OTHER_NODE);
    const report = await adapter.run([MATH], background(root));
    expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
    expect(statuses.at(-1)).toMatch(
      new RegExp(
        `^remote ${remote.destination} refused: .*Node v0\\.0\\.1-other on the remote, v\\S+ here.*; running here$`,
      ),
    );
  });

  it(
    "ends a paused container's run unknown within its deadline under whenLost not-run",
    LONG,
    async () => {
      const { adapter, root, statuses } = await lane("not-run");
      const started = Date.now();
      const running = adapter.run([SLOW], background(root));
      await new Promise((r) => setTimeout(r, 1_500));
      remote.pause();
      try {
        const report = await running;
        expect(report.end).toBe("timed-out");
        expect(report.completedFiles).toEqual([]);
        expect(report.results).toEqual([]);
        expect(Date.now() - started).toBeLessThan(15_000);
        expect(statuses.at(-1)).toMatch(
          new RegExp(`^remote ${remote.destination} unreachable since .*; 1 files not run$`),
        );
      } finally {
        remote.unpause();
      }
    },
  );

  // Review 0.1.442 B4: under the default `local`, the interrupted files run here in the same call.
  it("runs a killed host's interrupted files here at once under whenLost local", LONG, async () => {
    const { adapter, root, statuses } = await lane("local");
    const running = adapter.run([SLOW], background(root));
    await new Promise((r) => setTimeout(r, 1_500));
    // The host process dies on the remote (no procps in the image: through /proc).
    remote.exec(
      'for p in /proc/[0-9]*; do tr "\\0" " " < $p/cmdline 2>/dev/null | grep -q "runner-hos[t] .*--tree" && kill -9 $(basename $p); done; true',
    );
    const report = await running;
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => r.outcome)).toEqual(["pass"]);
    expect(statuses.at(-1)).toMatch(
      new RegExp(`^remote ${remote.destination} unreachable since .*; running here$`),
    );
  });

  /** How many times the container's fake `git` ran. */
  const gitCalls = () => Number(remote.exec(`cat ${GIT_CALLS} 2>/dev/null | wc -l`).trim());

  it(
    "refuses a remote that lacks a command the tests need, names it, and runs here",
    LONG,
    async () => {
      const { adapter, root, statuses } = await lane("local", "/opt/node/bin/node", {
        commands: ["sh", "squeal-e2e-absent"],
      });
      expect(statuses.at(-1)).toBe(
        `remote ${remote.destination} refused: tests need squeal-e2e-absent; not found on PATH there; running here`,
      );
      const report = await adapter.run([MATH], background(root));
      expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
    },
  );

  it(
    "never sends a needsRepository file there; the rest of its tier runs there, proven",
    LONG,
    async () => {
      const before = gitCalls();
      const { adapter, root, logs, repository } = await lane("local", "/opt/node/bin/node", {
        needsRepository: ["test/git.test.ts"],
      });
      const report = await adapter.run([MATH, GIT], background(root));
      expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([
        [GIT.path, "pass"],
        [MATH.path, "pass"],
        [MATH.path, "pass"],
      ]);
      expect(gitCalls()).toBe(before);
      expect(logs.some((line) => / run proven over \d+ paths$/.test(line))).toBe(true);
      expect(repository).toEqual([]);
    },
  );

  it(
    "keeps no remote 'not a git repository' failure: the file runs here and is named",
    LONG,
    async () => {
      const before = gitCalls();
      const { adapter, root, logs, repository } = await lane();
      const report = await adapter.run([MATH, GIT], background(root));
      expect(gitCalls()).toBe(before + 1);
      expect(report.results.map((r) => [r.check.testPath, r.outcome])).toEqual([
        [MATH.path, "pass"],
        [MATH.path, "pass"],
        [GIT.path, "pass"],
      ]);
      expect(logs).toContain(
        `remote ${remote.destination}: test/git.test.ts failed there as not a Git repository; running here`,
      );
      expect(repository).toEqual([
        "1 test file failed on the remote as not a Git repository, so it runs here: test/git.test.ts; add it to remote.needsRepository in squeal.config.json",
      ]);
      await adapter.run([GIT], background(root));
      expect(gitCalls()).toBe(before + 1);
    },
  );
});
