import { existsSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { git } from "../hash/git-repo.js";
import {
  type BuiltCli,
  buildCli,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
  waitReady,
} from "./helpers.js";
import {
  alive,
  daemonTempDir,
  exitWithin,
  heldBy,
  inside,
  linkedFixture,
  resultOf,
  tree,
} from "./scratch-helpers.js";

/*
 * Spec 001 D10 as amended after review wave 7.6, B2: runner calls run with
 * the root as working directory, so a long-lived process the project's tools
 * start during one keeps it until the daemon exits. esbuild's service is one:
 * it records `process.cwd()` when its module loads and lives as long as its
 * parent, and Vite 6 and 7 start it for every TypeScript transform. The
 * worktree can still be removed, and the daemon then exits and takes the
 * service with it.
 */

const processes: SpawnedProcess[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** The scheduler fixture's config plus a plugin that calls esbuild, as Vite 6 and 7 do. */
const ESBUILD_CONFIG = `import { transform } from "esbuild";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "esbuild-service",
      async transform(code, id) {
        if (id.endsWith(".ts") && !id.includes("/node_modules/")) await transform(code, { loader: "ts" });
        return null;
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
`;

describe.runIf(process.platform === "linux")(
  "squeal daemon: a child a runner call started (spec 001 D10)",
  SLOW,
  () => {
    let built: BuiltCli;
    beforeAll(() => {
      built = buildCli();
    });
    afterAll(() => built.cleanup());

    it("holds the root until the daemon exits, and git worktree remove still succeeds", async () => {
      const repo = linkedFixture(cleanups, { "vitest.config.ts": ESBUILD_CONFIG });
      const spawned = spawnCli(built.cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
      processes.push(spawned);
      await waitReady(repo, spawned);
      const pid = spawned.child.pid ?? 0;
      expect((await resultOf(repo, spawned, "test/math.test.ts")).outcome).toBe("pass");

      // The service, a descendant of the daemon, keeps the root as its working
      // directory; the daemon itself has left it.
      const holders = await waitFor(
        () => {
          const inRoot = heldBy(tree(pid)).filter(({ path }) => inside(path, repo.root));
          return inRoot.length > 0 && inRoot.every((each) => each.pid !== pid) ? inRoot : null;
        },
        30_000,
        "only a descendant of the daemon holding the root",
      ).catch((error: Error) => {
        throw new Error(`${error.message}: ${JSON.stringify(heldBy(tree(pid)))}`);
      });

      git(repo.mainRoot, ["worktree", "remove", repo.root]);
      expect(existsSync(repo.root)).toBe(false);
      expect(await exitWithin(spawned, 15_000)).toEqual({ code: 0, signal: null });
      await waitFor(
        () => holders.every(({ pid: each }) => !alive(each)),
        10_000,
        "the service gone with the daemon",
      );
      expect(existsSync(daemonTempDir(repo.commonDir, repo.worktreeId))).toBe(false);
    });
  },
);
