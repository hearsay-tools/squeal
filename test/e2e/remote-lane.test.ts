import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import { startRemoteHost, treeDir } from "../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../src/core/runner-host/remote/lane.js";
import type { WhenLost } from "../../src/core/runner-host/remote/settings.js";
import type { RunnerAdapter, RunOptions } from "../../src/core/types/runner.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { buildBundle, gitFixture } from "../runner-host/remote/helpers.js";
import { dockerUnavailable, REMOTE_CACHE, type Remote, startRemote } from "./remote-container.js";

/*
 * Spec 021 Testing, Part 3 (row 021-14): a background run on a container
 * over the real `ssh`, through the lane the daemon builds. A tree that
 * differs is refused, sent again and retried; a different Node is refused;
 * a paused container ends its run `unknown` within its deadline; then
 * `local` runs the next background run here and `not-run` leaves it.
 */

const unavailable = dockerUnavailable();
const LONG = { timeout: 600_000 } as const;
const MATH = { project: "", path: "test/math.test.ts" };
const SLOW = { project: "", path: "test/slow.test.ts" };
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
      ].join(" && "),
    );
  }, LONG.timeout);
  afterAll(() => {
    remote?.stop();
    rmSync(scratch, { recursive: true, force: true });
  });

  async function lane(whenLost: WhenLost = "local", node = "/opt/node/bin/node") {
    const root = gitFixture("basic", {
      ".gitignore": ".squeal-logs/\n",
      "test/slow.test.ts":
        'import { it } from "vitest";\nit("waits", async () => { await new Promise((r) => setTimeout(r, 6000)); });\n',
    });
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    // The options the remote gets: the same recorder on both sides, as the daemon gives them.
    const local = await createVitestAdapter({ root, observe: () => true });
    const statuses: string[] = [];
    const logs: string[] = [];
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
          options: { childEnv: {} },
          policy: () => ({
            observe: true,
            exclude: [],
            excludeProjects: [],
            coverage: false,
            coverageChildren: false,
          }),
          deadlines: { aliveMs: 3_000 },
        }),
      allowlist: () => [],
      status: (text) => statuses.push(text),
      log: (text) => logs.push(text),
    });
    onTestFinished(() => adapter.close());
    const settled = () => statuses.some((s) => / go there| refused| unreachable/.test(s));
    for (let i = 0; i < 600 && !settled(); i++) await new Promise((r) => setTimeout(r, 50));
    return { adapter, root, statuses, logs, tree: `${treeDir(places, root)}/root` };
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
    "ends a paused container's run unknown within its deadline; local then runs the next here",
    LONG,
    async () => {
      const { adapter, root, statuses } = await lane("local");
      const started = Date.now();
      const running = adapter.run([SLOW], background(root));
      await new Promise((r) => setTimeout(r, 1_500));
      remote.pause();
      try {
        const report = await running;
        expect(report.end).toBe("timed-out");
        expect(report.completedFiles).toEqual([]);
        expect(Date.now() - started).toBeLessThan(15_000);
        expect(statuses.at(-1)).toMatch(
          new RegExp(`^remote ${remote.destination} unreachable since .*; running here$`),
        );
        const here = await adapter.run([MATH], background(root));
        expect(here.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
      } finally {
        remote.unpause();
      }
    },
  );

  it("leaves a lost remote's files not run under whenLost not-run", LONG, async () => {
    const { adapter, root, statuses } = await lane("not-run");
    const running = adapter.run([SLOW], background(root));
    await new Promise((r) => setTimeout(r, 1_500));
    // The host process dies on the remote (no procps in the image: through /proc).
    remote.exec(
      'for p in /proc/[0-9]*; do tr "\\0" " " < $p/cmdline 2>/dev/null | grep -q "runner-hos[t] .*--tree" && kill -9 $(basename $p); done; true',
    );
    expect((await running).end).toBe("crashed");
    const next = await adapter.run([MATH], background(root));
    expect(next.end).toBe("crashed");
    expect(next.failure).toMatch(/not run here/);
    expect(statuses.at(-1)).toMatch(/unreachable since .*; 1 files not run$/);
  });
});
