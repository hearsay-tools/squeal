import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type BuiltCli,
  buildCli,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitReady,
} from "./helpers.js";
import { callerTempDir, exitWithin, linkedFixture, resultOf, TMP_TEST } from "./scratch-helpers.js";

/*
 * Review wave 7.7, N2: another local user who makes `/tmp/squeal-<uid>`
 * first costs this user only the shared temp directory. The daemon serves
 * with a private directory of its own and says so in one note. Another
 * user is played by a uid the test does not have, so the directory the test
 * makes is owned by someone else as the daemon sees it.
 */

const processes: SpawnedProcess[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe.runIf(process.platform === "linux")(
  "squeal daemon: /tmp/squeal-<uid> refused (spec 001 D10)",
  SLOW,
  () => {
    let built: BuiltCli;
    beforeAll(() => {
      built = buildCli();
    });
    afterAll(() => built.cleanup());

    it("serves with a private temp directory of its own, notes why, and removes it on exit", async () => {
      const repo = linkedFixture(cleanups, { "test/tmp.test.ts": TMP_TEST });
      const uid = 3_000_000_000 + Math.floor(Math.random() * 1_000_000);
      const taken = `/tmp/squeal-${uid}`;
      mkdirSync(taken, { mode: 0o700 });
      cleanups.push(() => {
        for (const name of readdirSync("/tmp").filter((n) => n.startsWith(`squeal-${uid}`))) {
          rmSync(join("/tmp", name), { recursive: true, force: true });
        }
      });
      const preload = join(callerTempDir(cleanups), "uid.mjs");
      writeFileSync(preload, `process.getuid = () => ${uid};\n`);
      const spawned = spawnCli(built.cli, ["daemon", repo.root], {
        cwd: "/",
        env: { ...repo.env, NODE_OPTIONS: `--import=${preload}` },
      });
      processes.push(spawned);
      await waitReady(repo, spawned);

      expect((await resultOf(repo, spawned, "test/tmp.test.ts")).outcome).toBe("pass");
      const notes = readNotes(repo);
      const pattern = new RegExp(
        `^temp directory ${taken} is owned by uid \\d+, not ${uid}; refusing to use it; using (${taken}-[0-9a-f]{16}-\\w{6}) instead$`,
      );
      expect(notes.filter((note) => pattern.test(note))).toHaveLength(1);
      const fallback = notes.map((note) => pattern.exec(note)?.[1]).find(Boolean) ?? "";
      expect(readdirSync(fallback).some((name) => name.startsWith("x-"))).toBe(true);
      expect(readdirSync(taken)).toEqual([]);

      spawned.child.kill("SIGTERM");
      expect(await exitWithin(spawned, 30_000)).toEqual({ code: 0, signal: null });
      expect(existsSync(fallback)).toBe(false);
    });
  },
);
