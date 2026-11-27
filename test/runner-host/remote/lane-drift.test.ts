import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { squealVersion } from "../../../src/core/daemon/version.js";
import { spawnRunnerHost } from "../../../src/core/runner-host/channel.js";
import type { HostPolicy } from "../../../src/core/runner-host/protocol.js";
import { startHostProxy } from "../../../src/core/runner-host/proxy.js";
import { startRemoteHost, treeDir } from "../../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import type { WhenLost } from "../../../src/core/runner-host/remote/settings.js";
import { readEntry, treePathsFor } from "../../../src/core/runner-host/remote/tree.js";
import type { InvalidatedPath, RunOptions } from "../../../src/core/types/runner.js";
import { SLOW } from "../../daemon/helpers.js";
import { buildBundle, fakeSsh, gitFixture, scratchDir } from "./helpers.js";

/*
 * Row 026-40 (#300; spec 026 D8, D12; 021 D10, D11, D13): remote validation
 * after a merge that updates fixtures and after a new helper a setup file
 * imports, with a real Vitest on both sides over a fake `ssh` that runs the
 * remote command in a directory of this machine. Delivered, the
 * invalidation brings both there and both validate. Undelivered (the runner
 * here is told and the remote is not, as when a lane drops it while asleep
 * or down), the merged fixture differs in the run's proof and its resend
 * repairs it; the setup file and its new helper differ in the config
 * comparison, which before row 026-40 refused at once, and now sends them
 * again once and compares again.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-drift-"));
let cli = "";
beforeAll(async () => {
  cli = await buildBundle(join(scratch, "dist"));
}, SLOW.timeout);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const places = { node: process.execPath, cache: ".cache" };
const POLICY: HostPolicy = {
  observe: true,
  exclude: [],
  excludeProjects: [],
  coverage: false,
  coverageChildren: false,
};
const GOLDEN = { project: "", path: "test/golden.test.ts" };
const MATH = { project: "", path: "test/math.test.ts" };

/** This process's env with only what a host needs: no CI variable. */
function withoutCi(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG"] as const;
  return Object.fromEntries(
    keep.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/**
 * A real `ssh` passes no local environment variable to the remote machine;
 * the fake one runs the remote command here with this process's
 * environment. Under CI, `CI` and `GITHUB_ACTIONS` would then reach the
 * remote Vitest, whose run ends `crashed`, so the remote command runs without
 * them, as it would over `ssh`.
 */
function withoutCiSsh(ssh: string): string {
  const path = `${ssh}-without-ci`;
  writeFileSync(path, `#!/bin/sh\nexec env -u CI -u GITHUB_ACTIONS ${JSON.stringify(ssh)} "$@"\n`);
  chmodSync(path, 0o755);
  return path;
}

async function lane(whenLost: WhenLost) {
  const root = gitFixture("basic", {
    ".gitignore": ".squeal-logs/\n",
    "fixtures/golden.json": '{ "answer": 1 }\n',
    [GOLDEN.path]: [
      'import { readFileSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'it("reads the golden fixture", () => {',
      '  expect(JSON.parse(readFileSync("fixtures/golden.json", "utf8")).answer).toBeGreaterThan(0);',
      "});",
      "",
    ].join("\n"),
  });
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=s", "-c", "user.email=s@e", ...args], {
      encoding: "utf8",
    });
  git("add", "-A");
  git("commit", "-qm", "fixture");
  const home = join(scratchDir, `remote-home-${randomUUID()}`);
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const ssh = withoutCiSsh(fakeSsh(join(home, ".bin"), home));
  const options = { childEnv: {} };
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
  const adapter = withRemoteLane({
    target: "box",
    whenLost,
    root,
    version: squealVersion(),
    local,
    connect: () =>
      startRemoteHost({
        target: { destination: "box", ssh },
        places,
        launch: { execPath: process.execPath, execArgv: [], cli },
        version: squealVersion(),
        root,
        runner: "vitest",
        options,
        policy: () => POLICY,
        log: (text) => logs.push(text),
      }),
    allowlist: () => [],
    status: (text) => statuses.push(text),
    log: (text) => logs.push(text),
  });
  onTestFinished(() => adapter.close());
  const settled = () => statuses.some((s) => / go there| refused| unreachable/.test(s));
  for (let i = 0; i < 1200 && !settled(); i++) await new Promise((r) => setTimeout(r, 50));
  const tree = join(home, treeDir(places, root), "root");
  /** Local and remote blob ids of `paths`, and whether each is in the local tree. */
  const blobs = async (paths: readonly string[]) => {
    const inTree = await treePathsFor(root, paths);
    return Object.fromEntries(
      await Promise.all(
        paths.map(async (path) => [
          path,
          {
            here: (await readEntry(root, path))?.entry.blob ?? null,
            there: (await readEntry(tree, path))?.entry.blob ?? null,
            inTree: inTree.has(path),
          },
        ]),
      ),
    );
  };
  return { adapter, local, root, tree, git, statuses, logs, blobs };
}

const background = (root: string): RunOptions => ({
  runId: randomUUID(),
  logDir: join(root, ".squeal-logs", randomUUID()),
  timeoutMs: 60_000,
  background: true,
  workers: 1,
  lane: "vitest",
});

/** The paths `from..to` changed, as the daemon's watcher hands them on. */
const changed = (git: (...args: string[]) => string, range: string): InvalidatedPath[] =>
  git("diff", "--name-status", "--no-renames", range)
    .trim()
    .split("\n")
    .map((line) => {
      const [status, path = ""] = line.split("\t");
      return { path, kind: status === "D" ? "delete" : status === "A" ? "add" : "change" };
    });

describe.each([true, false])(
  "remote validation after a merge or a new helper (row 026-40), invalidation delivered: %s",
  SLOW,
  (deliver) => {
    it("validates merge-updated fixtures remotely", async () => {
      const s = await lane("not-run");
      expect((await s.adapter.run([GOLDEN, MATH], background(s.root))).end).toBe("completed");
      const base = s.git("rev-parse", "HEAD").trim();
      s.git("checkout", "-qb", "topic");
      writeFileSync(join(s.root, "fixtures/golden.json"), '{ "answer": 2 }\n');
      writeFileSync(join(s.root, "fixtures/README.md"), "golden fixtures\n");
      s.git("add", "-A");
      s.git("commit", "-qm", "topic");
      s.git("checkout", "-q", "-");
      writeFileSync(
        join(s.root, "src/strings.ts"),
        `${readFileSync(join(s.root, "src/strings.ts"), "utf8")}// main\n`,
      );
      s.git("commit", "-qam", "main");
      s.git("merge", "-q", "--no-edit", "topic");
      const paths = changed(s.git, `${base}..HEAD`);
      // Undelivered: the runner here is told, the remote is not (a lane asleep or down drops it).
      await (deliver ? s.adapter : s.local).invalidate(paths);
      const report = await s.adapter.run([GOLDEN, MATH], background(s.root));
      // Here and there equal after the run, by blob id: every path delivered, else the run's input.
      // An undelivered path no run reads stays as it was there, which proves nothing.
      const blobs = await s.blobs(paths.map((p) => p.path));
      for (const path of deliver ? paths.map((p) => p.path) : ["fixtures/golden.json"]) {
        expect(blobs[path]).toMatchObject({ there: blobs[path]?.here, inTree: true });
      }
      expect(s.logs.filter((line) => line.includes("sending again"))).toEqual(
        deliver ? [] : ["remote box: tree differs at fixtures/golden.json; sending again"],
      );
      expect(report.completedFiles.map((f) => f.path).sort()).toEqual([GOLDEN.path, MATH.path]);
      expect(report.end).toBe("completed");
      expect(report.failure).toBeNull();
    });

    it("validates after a new helper that a setup file imports", async () => {
      const s = await lane("not-run");
      expect((await s.adapter.run([MATH], background(s.root))).end).toBe("completed");
      writeFileSync(join(s.root, "src/helper.ts"), 'export const help = "help";\n');
      writeFileSync(
        join(s.root, "test/setup.ts"),
        `import { help } from "../src/helper.ts";\n${readFileSync(join(s.root, "test/setup.ts"), "utf8")}(globalThis as { help?: string }).help = help;\n`,
      );
      const paths: InvalidatedPath[] = [
        { path: "src/helper.ts", kind: "add" },
        { path: "test/setup.ts", kind: "change" },
      ];
      // Undelivered: the runner here is told, the remote is not (a lane asleep or down drops it).
      await (deliver ? s.adapter : s.local).invalidate(paths);
      const report = await s.adapter.run([MATH], background(s.root));
      const blobs = await s.blobs(paths.map((p) => p.path));
      for (const path of paths) expect(blobs[path.path]?.there).toBe(blobs[path.path]?.here);
      // The remote's Vitest reads the new helper as a setup file.
      expect((await s.adapter.environment())[0]?.files).toContain("src/helper.ts");
      expect(s.logs.filter((line) => line.includes("sending again"))).toEqual(
        deliver
          ? []
          : [
              "remote box: config and setup files differ at test/setup.ts, src/helper.ts; sending again",
            ],
      );
      expect(report.end).toBe("completed");
      expect(report.failure).toBeNull();
    });
  },
);
