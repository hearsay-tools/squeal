import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { REPORT } from "../fake-channel.js";
import { background, ENV, REF, setup } from "./lane-fixture.js";

/*
 * Review 0.1.442 (row 021-14 repair R1). B1: the environment is compared
 * for every remote run, after the revision's files and any install reached
 * the host. B2: signs of life prove the transport, not the run: a run
 * without a test timeout whose files stop ending is lost. B4: under
 * `whenLost: "local"` a lost attempt's files run here at once.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-lane-repair-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A fake `npm` whose `ci` leaves an install only once the lockfile says `changed`. */
function fakeNpm(): NodeJS.ProcessEnv {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "npm"),
    [
      "#!/bin/sh",
      "grep -q changed package-lock.json || exit 0",
      "mkdir -p node_modules",
      `printf '%s' '{"name":"x","lockfileVersion":3,"requires":true,"packages":{}}' > node_modules/.package-lock.json`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "npm"), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

describe("review 0.1.442 repairs of the remote lane", () => {
  it("B1: refuses a remote whose environment changed after a proven run, and names the change", async () => {
    const s = await setup();
    expect((await s.lane.run([REF], background())).end).toBe("completed");
    expect(s.remoteRuns).toHaveLength(1);
    s.remote.env = { ...ENV, runnerVersion: "5.0.2" };
    await s.lane.invalidate([{ path: "src/a.ts", kind: "change" }]);
    const report = await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localRuns).toHaveLength(1);
    expect(report.end).toBe("completed");
    expect(s.statuses.at(-1)).toMatch(
      /^remote box refused: .*5\.0\.2 on the remote, 5\.0\.3 here.*; running here$/,
    );
  });

  it("B1: compares after a lockfile change was sent and installed, so a changed install is refused", async () => {
    const s = await setup({
      installEnv: fakeNpm(),
      files: { "package.json": "{}\n", "package-lock.json": '{"lockfileVersion":3}\n' },
    });
    expect((await s.lane.run([REF], background())).end).toBe("completed");
    writeFileSync(join(s.root, "package-lock.json"), '{"lockfileVersion":3,"changed":1}\n');
    await s.lane.invalidate([{ path: "package-lock.json", kind: "change" }]);
    await s.lane.run([REF], background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localRuns).toHaveLength(1);
    expect(s.statuses.at(-1)).toMatch(/^remote box refused: .*installed.*; running here$/i);
  });

  it("B2: ends a run without a test timeout whose files stop ending, though its host stays alive", async () => {
    const s = await setup({
      whenLost: "not-run",
      deadlines: { aliveMs: 100, runIdleMs: 400 },
      remoteRun: () => new Promise(() => {}),
    });
    const started = Date.now();
    const report = await s.lane.run([REF], background({ timeoutMs: null }));
    expect(report.end).toBe("timed-out");
    expect(report.results).toEqual([]);
    expect(report.failure).toMatch(/nor end a file of it, within 400 ms/);
    expect(Date.now() - started).toBeLessThan(3_000);
    // A new host replaces it once the backoff passed.
    s.advance(60_000);
    await s.lane.run([REF], background());
    expect(s.connects).toHaveLength(2);
  });

  it("B2: keeps a long run without a test timeout whose files go on ending", async () => {
    const s = await setup({
      deadlines: { aliveMs: 100, runIdleMs: 400 },
      remoteRun: async (_root, _hang, options) => {
        for (let i = 0; i < 6; i++) {
          await sleep(150);
          options.fileEnded?.(REF);
        }
        return { ...REPORT, completedFiles: [REF] };
      },
    });
    const report = await s.lane.run([REF], background({ timeoutMs: null }));
    expect(report.end).toBe("completed");
    expect(s.localRuns).toHaveLength(0);
  });

  it("B4: runs a lost attempt's files here at once under whenLost local, in a log directory of their own", async () => {
    const s = await setup({
      remoteRun: (_root, _hang, _options, kill) => {
        kill();
        return new Promise(() => {});
      },
    });
    const run = background();
    const report = await s.lane.run([REF], run);
    expect(report.end).toBe("completed");
    expect(report.completedFiles).toEqual([REF]);
    expect(s.localRuns.map((o) => o.logDir)).toEqual([join(run.logDir, "here")]);
    expect(s.statuses.at(-1)).toMatch(/^remote box unreachable since .*; running here$/);
  });

  it("B4: keeps nothing of a lost attempt of a cancelled tier and runs nothing here", async () => {
    const cancel = new AbortController();
    const s = await setup({
      remoteRun: (_root, _hang, _options, kill) => {
        cancel.abort("backlog");
        kill();
        return new Promise(() => {});
      },
    });
    const report = await s.lane.run([REF], background({ signal: cancel.signal }));
    expect(report.end).toBe("crashed");
    expect(report.results).toEqual([]);
    expect(s.localRuns).toHaveLength(0);
  });
});
