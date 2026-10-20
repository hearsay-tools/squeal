import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonSuite, SLOW, spawnCli, waitReady } from "../daemon/helpers.js";

/*
 * Spec 011 C5 as amended (gh-36, row 011-16), the issue's case on a real
 * daemon: a test file left `unknown` at its key, which retry refused before,
 * is queued by `squeal retry` and run once, and a named `status --wait`
 * returns its result
 * while the files its crashed tier left unknown stay unrun.
 */

const suite = daemonSuite();
const CRASH = "test/crash.test.ts";

/** Kills its worker while `marker` exists, so the run stores no result. */
const crashing = (marker: string) => `import { existsSync } from "node:fs";
import { expect, it } from "vitest";

it("holds", () => {
  if (existsSync(${JSON.stringify(marker)})) process.kill(process.pid, "SIGKILL");
  expect(1).toBe(1);
});
`;

describe("squeal retry on an unknown file, on a real daemon (011 C5, gh-36)", SLOW, () => {
  it("queues and runs it once, and a named wait returns its result", async () => {
    const marker = join(tmpdir(), `squeal-011-16-${randomUUID()}`);
    writeFileSync(marker, "");
    suite.cleanup(() => rmSync(marker, { force: true }));
    const repo = suite.fixture({ [CRASH]: crashing(marker) });
    suite.daemon(repo);
    await waitReady(repo);
    const cli = (args: string[]) => spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });

    const before = cli(["status", "--wait", "120000", CRASH]);
    expect(await before.exited, before.stdout()).toEqual({ code: 3, signal: null });
    expect(before.stdout()).toContain("1 unknown");
    rmSync(marker);

    const retry = cli(["retry", CRASH, "--reason", "load"]);
    expect(await retry.exited, retry.stderr()).toEqual({ code: 0, signal: null });
    expect(retry.stdout()).toMatch(
      /^Run queued: test\/crash\.test\.ts has no result at its inputs \(unknown: .+\)\. It runs once now/,
    );

    const after = cli(["status", "--wait", "120000", CRASH]);
    expect(await after.exited, after.stdout()).toEqual({ code: 0, signal: null });
    // Row 011-28: the named wait prints the selection, its verdict last.
    expect(after.stdout()).toContain(
      "Named test files at revision 0: no known failures; 1 test file, each with a current result,",
    );
    // Only the named file ran: the tier's other files, unknown since the crash, are not re-run.
    expect(after.stdout()).toContain("not current: 5 of 6 test files (5 unknown)");
  });
});
