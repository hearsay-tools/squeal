import { describe, expect, it } from "vitest";
import { cgroupUnit, signalNote } from "../../src/core/daemon/signals.js";
import { readDaemonNotes } from "../../src/core/notes.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { daemonSuite, SLOW, stopProcess, waitReady, withStore } from "./helpers.js";

/*
 * Task 001-413: cezar's status repeated each node:test project's
 * incomplete-closure note once per daemon start, beside each start's
 * "daemon stopped" note. The closure note has a topic per project, so the
 * store keeps it as one; status lists a repeated stop note once, counted.
 * Row 011-250: each stop is a SIGTERM, and its note names it and the unit
 * the daemon ran in, the test's own, since a child stays in its parent's.
 */

const suite = daemonSuite();
const STARTS = 3;
const STOP_NOTE = signalNote("SIGTERM", cgroupUnit());
const PROJECTS = ["alpha", "beta"] as const;

const computed = [
  'import { test } from "node:test";',
  'const helper = "./helper.mjs";',
  'test("loads its helper", async () => { await import(helper); });',
  "",
].join("\n");

function files(): Record<string, string> {
  const config = {
    nodeTest: PROJECTS.map((name) => ({
      name,
      cwd: name,
      include: ["test/*.test.mjs"],
      argv: [],
      env: {},
    })),
  };
  return {
    "squeal.config.json": JSON.stringify(config),
    ...Object.fromEntries(
      PROJECTS.flatMap((name) => [
        [`${name}/test/computed.test.mjs`, computed],
        [`${name}/test/helper.mjs`, "export const ok = true;\n"],
      ]),
    ),
  };
}

describe("notes repeated by every daemon start (001-413)", () => {
  it(
    `${STARTS} starts leave one closure note per project, and status one stop line`,
    SLOW,
    async () => {
      const repo = suite.fixture(files());
      for (let start = 0; start < STARTS; start++) {
        const daemon = suite.daemon(repo);
        await waitReady(repo, daemon);
        await stopProcess(daemon);
      }

      const notes = withStore(repo, (store) => readDaemonNotes(store, repo.worktreeId));
      const closures = notes.filter((n) => n.text.includes("incomplete static closure"));
      expect(closures.map((n) => n.topic).sort()).toEqual(
        PROJECTS.map((name) => `node-test-closure:${name}`),
      );
      const stops = notes.filter((n) => n.exitOf !== undefined);
      expect(STOP_NOTE).toMatch(
        /^daemon stopped: SIGTERM( while it ran in systemd unit \S+\.(service|scope))?; the next Squeal hook starts a new daemon, or `squeal start` starts one now$/,
      );
      expect(stops.map((n) => n.text)).toEqual(Array(STARTS).fill(STOP_NOTE));

      const result = readStatus(repo.root as AbsolutePath, { now: () => Date.now() });
      const text = formatStatus(result, Date.now(), "squeal", { full: true }).split("\n");
      const since = new Date(stops[0]?.at ?? 0).toISOString();
      expect(text.filter((line) => line.includes(STOP_NOTE))).toEqual([
        expect.stringContaining(
          `${STOP_NOTE} (${STARTS} notes since ${since}; \`squeal status --notes\` lists each)`,
        ),
      ]);
      expect(text.filter((line) => line.includes("incomplete static closure"))).toHaveLength(
        PROJECTS.length,
      );
      const all = formatStatus(result, Date.now(), "squeal", { allNotes: true }).split("\n");
      expect(all.filter((line) => line.endsWith(STOP_NOTE))).toHaveLength(STARTS);
    },
  );
});
