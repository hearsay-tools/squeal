import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { afterEachRun, EscapedChildren } from "../../../src/core/daemon/escaped.js";
import type { CancelCause, RunReport } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { isAlive } from "../../daemon/strays.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Row 011-245 (gh-101; 013 `research/issue-101.md`, findings 2 and 3): a
 * test starts a SIGTERM-ignoring holder in a group and env of its own, here
 * through a `sh` leader that exits at once, as the research's probe did, so
 * the holder's parent is the reaper before any cancel. A run cut by its
 * forced cancel names it in `RunReport.outlived`, and the daemon's wrapper
 * names its pid and command in a note after its sweep, which stops it not;
 * a teardown that ends it in the grace leaves none. Squeal signals no
 * holder: each test kills its own.
 */

const FILE = "test/holder.test.ts";

/** Ignores SIGTERM, then writes its pid to `ready`; lives `lifetime` ms. Its token names it. */
const HOLDER = `process.on("SIGTERM", () => {});
require("node:fs").writeFileSync(process.argv[3], String(process.pid));
setTimeout(() => {}, Number(process.argv[4]));
`;

type Shape = "block" | "slow-teardown" | "cooperative" | "direct";

/** The fixture's test: starts the holder, writes `started`, then waits or blocks as `shape` says. */
function holderTest(shape: Shape, holder: string, token: string, dir: string): string {
  const path = (name: string) => JSON.stringify(join(dir, name));
  const env = "{ PATH: process.env.PATH ?? '' }";
  const start =
    shape === "direct"
      ? `spawn(process.execPath, [${JSON.stringify(holder)}, ${JSON.stringify(token)}, ${path("ready")}, "60000"], { detached: true, stdio: "ignore", env: ${env} })`
      : `spawn("/bin/sh", ["-c", '"$0" "$1" "$2" "$3" 60000 & exit 0', process.execPath, ${JSON.stringify(holder)}, ${JSON.stringify(token)}, ${path("ready")}], { detached: true, stdio: "ignore", env: ${env} })`;
  const wait =
    shape === "block" || shape === "direct"
      ? "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);"
      : "await new Promise((done) => setTimeout(done, 60_000));";
  const teardown = {
    block: "",
    direct: "",
    // The research's slow teardown: SIGTERM to the group, 2 s, then SIGKILL, longer than the 1 s grace.
    "slow-teardown": `afterEach(async () => {
  try { process.kill(-leader, "SIGTERM"); } catch {}
  await new Promise((done) => setTimeout(done, 2_000));
  try { process.kill(-leader, "SIGKILL"); } catch {}
});`,
    cooperative: `afterEach(() => {
  try { process.kill(-leader, "SIGKILL"); } catch {}
});`,
  }[shape];
  return `import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, it } from "vitest";
let leader = 0;
${teardown}
it("starts a holder", async () => {
  const child = ${start};
  child.unref();
  leader = child.pid ?? 0;
  for (;;) {
    try { if (readFileSync(${path("ready")}, "utf8") !== "") break; } catch {}
    await new Promise((done) => setTimeout(done, 10));
  }
  writeFileSync(${path("started")}, "");
  ${wait}
}, 120_000);
`;
}

interface Cut {
  readonly report: RunReport;
  readonly holder: number;
  /** The holder's command line as `/proc` gave it after the run, `""` once gone. */
  readonly command: string;
  /** What the daemon's wrapper (`afterEachRun`) noted after the run's sweep. */
  readonly notes: readonly string[];
  /** The run log's line on the reading before the forced cancel, or `undefined`. */
  readonly reading: string | undefined;
}

/** Runs the fixture's test as `shape`, cancelled with `cause` once its holder is ready. */
async function cutRun(shape: Shape, observe: boolean, cause: CancelCause): Promise<Cut> {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-245-"));
  const token = `squeal-011-245-${randomUUID()}`;
  const ready = join(dir, "ready");
  // The test kills the holder it started, only while its pid still names the token, then
  // drops the directory that names the pid.
  onTestFinished(() => {
    const pid = existsSync(ready) ? Number(readFileSync(ready, "utf8")) : 0;
    if (pid > 0 && isAlive(pid) && commandOf(pid).includes(token)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  });
  const holder = join(dir, "holder.cjs");
  // A daemon's sweep of its own random mark, which the workers carry and the holder does not.
  const children = new EscapedChildren();
  const fx = await openFixture("basic", { [FILE]: holderTest(shape, holder, token, dir) }, (root) =>
    createVitestAdapter({ root, observe: () => observe, childEnv: children.envFor("vitest") }),
  );
  const notes: string[] = [];
  const runner = afterEachRun(fx.adapter, children, ({ text }) => notes.push(text));
  writeFileSync(holder, HOLDER);
  await fx.adapter.invalidate([{ path: FILE, kind: "add" }]);
  const controller = new AbortController();
  const options = fx.runOptions({ signal: controller.signal });
  const running = runner.run([ref(FILE)], options);
  await expect.poll(() => existsSync(join(dir, "started")), { timeout: 60_000 }).toBe(true);
  controller.abort(cause);
  const report = await running;
  const log = readFileSync(join(options.logDir, "vitest.log"), "utf8");
  const reading = log.split("\n").find((line) => line.includes("before the forced cancel"));
  const pid = Number(readFileSync(ready, "utf8"));
  return { report, holder: pid, command: commandOf(pid).trim(), notes, reading };
}

/** One note naming `holder` with its command; the run's id and the reaper's pid vary. */
function expectNamed(notes: readonly string[], holder: number, command: string): void {
  const shown = command.length > 120 ? `${command.slice(0, 117)}...` : command;
  expect(notes).toHaveLength(1);
  const [note] = notes;
  expect(note).toMatch(
    /^1 process a test started is still running after Squeal stopped its run [0-9a-f-]+; /,
  );
  expect(note).toContain(`; Squeal did not stop the process: ${holder} ${shown} (parent `);
  expect(note?.endsWith(`). \`kill ${holder}\` stops it.`)).toBe(true);
}

function commandOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
  } catch {
    return "";
  }
}

describe.runIf(process.platform === "linux")(
  "vitest adapter: a test's holder that outlives a forced cancel (row 011-245)",
  SLOW,
  () => {
    it("is named after a blocked test is cut, its leader long gone, by the recorder's settings", async () => {
      const { report, holder, command, notes, reading } = await cutRun(
        "block",
        true,
        "supersession",
      );

      expect(report.failure).toMatch(/^run cancelled: the revisions/);
      expect(report.outlived?.map(({ pid }) => pid)).toEqual([holder]);
      expectNamed(notes, holder, command);
      expect(isAlive(holder)).toBe(true);
      expect(reading).toMatch(/in \d+ ms: 1 found$/);
    });

    it("is named after a slow teardown is cut by a stop", async () => {
      const { report, holder, command, notes } = await cutRun("slow-teardown", true, "stop");

      expect(report.failure).toBe("run cancelled: squeal stop");
      expect(report.outlived?.map(({ pid }) => pid)).toEqual([holder]);
      expectNamed(notes, holder, command);
      expect(isAlive(holder)).toBe(true);
    });

    it("is not named when the teardown ends it in the grace: no forced cancel, no reading", async () => {
      const { report, holder, notes, reading } = await cutRun("cooperative", true, "supersession");

      expect(report.outlived).toBeUndefined();
      expect(notes).toEqual([]);
      expect(reading).toBeUndefined();
      expect(isAlive(holder)).toBe(false);
    });

    it("is named through the worker walk when nothing observes and the holder is the worker's child", async () => {
      const { report, holder, command, notes } = await cutRun("direct", false, "supersession");

      expect(report.outlived?.map(({ pid }) => pid)).toEqual([holder]);
      expectNamed(notes, holder, command);
      expect(isAlive(holder)).toBe(true);
    });
  },
);
