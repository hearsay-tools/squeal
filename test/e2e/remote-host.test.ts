import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import {
  type RemoteHostOptions,
  startRemoteHost,
  treeDir,
} from "../../src/core/runner-host/remote/connect.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { buildBundle, gitFixture } from "../runner-host/remote/helpers.js";
import { dockerUnavailable, REMOTE_CACHE, type Remote, startRemote } from "./remote-container.js";

/*
 * Spec 021 Testing, Part 3 (row 021-13): a runner host on a container over
 * the real `ssh`. First connect copies Squeal's bundle and the tree, never
 * an ignored file, and installs from the lockfile; an edit runs remotely.
 */

const unavailable = dockerUnavailable();
const LONG = { timeout: 600_000 } as const;
const places = { node: "/opt/node/bin/node", cache: REMOTE_CACHE };

/** A lockfile without dependencies: `npm ci` installs it offline. */
const LOCK = JSON.stringify({
  name: "squeal-fixture-vitest-basic",
  lockfileVersion: 3,
  requires: true,
  packages: { "": { name: "squeal-fixture-vitest-basic" } },
});

describe.skipIf(unavailable !== undefined)("a runner host on a container over ssh", () => {
  let remote: Remote;
  let cli = "";
  const scratch = mkdtempSync(join(tmpdir(), "squeal-e2e-remote-"));
  beforeAll(async () => {
    cli = await buildBundle(join(scratch, "dist"));
    remote = startRemote();
  }, LONG.timeout);
  afterAll(() => {
    remote?.stop();
    rmSync(scratch, { recursive: true, force: true });
  });

  function fixture(): string {
    const root = gitFixture("basic", {
      ".gitignore": ".env\n.squeal-logs/\n",
      ".env": "SECRET=1\n",
      "package-lock.json": LOCK,
    });
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    return root;
  }

  async function connect(
    root: string,
    lines: string[] = [],
    extra: Partial<RemoteHostOptions> = {},
  ): Promise<RunnerAdapter> {
    const { adapter } = await startRemoteHost({
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
      log: (text) => lines.push(text),
      ...extra,
    });
    onTestFinished(() => adapter.close());
    return adapter;
  }

  const run = (adapter: RunnerAdapter, root: string, path: string) =>
    adapter.run([{ project: "", path }], {
      runId: randomUUID(),
      logDir: join(root, ".squeal-logs", randomUUID()),
      timeoutMs: 60_000,
    });

  it("copies Squeal and the tree at first connect, installs, and runs there", LONG, async () => {
    const root = fixture();
    const lines: string[] = [];
    const adapter = await connect(root, lines);
    const tree = `${treeDir(places, root)}/root`;

    expect(
      remote.exec(`test -f ${REMOTE_CACHE}/squeal/${squealVersion()}/cli/squeal.mjs && echo ok`),
    ).toBe("ok\n");
    expect(remote.exec(`test -e ${tree}/.env && echo sent || echo never`)).toBe("never\n");
    // The host's record of its install: the lockfile's blob it installed from.
    expect(remote.exec(`cat ${treeDir(places, root)}/installed.json`)).toContain(
      "package-lock.json",
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`Squeal ${squealVersion()} copied`),
        expect.stringContaining("installed with npm ci"),
      ]),
    );
    const report = await run(adapter, root, "test/math.test.ts");
    expect(report.end).toBe("completed");
    expect(report.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
  });

  it("runs an edit remotely once it rode on the revision's invalidate", LONG, async () => {
    const root = fixture();
    const adapter = await connect(root);
    writeFileSync(
      join(root, "src/math.ts"),
      'import { base } from "./deep.ts";\nexport const add = (a: number, b: number) => a - b;\nexport const addBase = (a: number) => a + base;\n',
    );
    await adapter.invalidate([{ path: "src/math.ts", kind: "change" }]);
    const report = await run(adapter, root, "test/math.test.ts");
    expect(report.results.map((r) => r.outcome)).toEqual(["fail", "pass"]);
    expect(report.results[0]?.errors[0]?.message).toMatch(/expected -1 to be 3/);
  });

  it("reuses the copy and the install at the next connect", LONG, async () => {
    const root = fixture();
    await (await connect(root)).close();
    const lines: string[] = [];
    await connect(root, lines);
    expect(lines.some((l) => l.includes(`Squeal ${squealVersion()} present`))).toBe(true);
    expect(lines.some((l) => l.includes("installed with"))).toBe(false);
    expect(lines.some((l) => / files, 0 sent$/.test(l))).toBe(true);
  });
});
