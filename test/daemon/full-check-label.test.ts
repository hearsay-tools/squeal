import { readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFullCheck, startFullCheck } from "../../src/core/daemon/full-check.js";
import { storeCheckLabel } from "../../src/core/process-label.js";
import { storePaths } from "../../src/core/store/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { fakeCommonDir, open, seedIndexFault, tempDir } from "../store/helpers.js";
import { checkContext, heldCheck, until } from "./full-check-helpers.js";

/*
 * Spec 005 D3, project-first process commands (row 005-88): the integrity
 * check's process shows `squeal <project> check` as argv0 on Linux. Its
 * script, database and limit stay as they were, and so does what it answers.
 */

const T = 1_800_000_000_000;

/** The arguments `pid` was started with, held stopped while they are read. */
function cmdlineHeld(pid: number | undefined): string[] {
  if (pid === undefined) throw new Error("no check process");
  process.kill(pid, "SIGSTOP");
  try {
    expect(readlinkSync(`/proc/${pid}/exe`)).toBe(process.execPath);
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").slice(0, -1);
  } finally {
    process.kill(pid, "SIGCONT");
  }
}

describe("the full check's label (005-88)", () => {
  it("is the store's project for the check a daemon starts", async () => {
    const commonDir = fakeCommonDir() as AbsolutePath;
    const store = open(commonDir);
    const calls: [string, string][] = [];
    const one = checkContext(store, commonDir, [], () => T);
    const check = heldCheck();
    const stop = startFullCheck({
      ...one.context,
      run: (database, label) => {
        calls.push([database, label]);
        return check;
      },
    });
    await until(() => calls.length === 1);
    check.end({ ok: true });
    await until(() => one.logs.includes("full integrity check: ok"));
    await stop();
    const label = `squeal ${basename(dirname(commonDir))} check`;
    expect(label).toBe(storeCheckLabel(commonDir));
    expect(calls).toEqual([[storePaths(commonDir).database, label]]);
  });

  describe.runIf(process.platform === "linux")("on Linux", () => {
    it("is the check process's argv0, its arguments kept, and it still finds a fault", async () => {
      const commonDir = fakeCommonDir();
      seedIndexFault(commonDir);
      const database = storePaths(commonDir).database;
      const check = runFullCheck(database, "squeal project check");
      const args = cmdlineHeld(check.pid);
      expect(args[0]).toBe("squeal project check");
      expect(args[1]).toBe("-e");
      expect(args.slice(3)).toEqual([database, "10"]);
      expect(await check.done).toEqual({
        problem: expect.stringContaining("row 1 missing from index fault_a"),
      });
    });

    it("leaves argv0 as Node's path without a label, and passes a sound store", async () => {
      const commonDir = fakeCommonDir();
      open(commonDir).meta.set("kept", "yes");
      const check = runFullCheck(storePaths(commonDir).database);
      expect(cmdlineHeld(check.pid)[0]).toBe(process.execPath);
      expect(await check.done).toEqual({ ok: true });
    });
  });

  it("reports a labelled check whose Node is gone as unrun", async () => {
    const execPath = process.execPath;
    process.execPath = join(tempDir(), "node");
    try {
      const check = runFullCheck(storePaths(fakeCommonDir()).database, "squeal project check");
      expect(await check.done).toEqual({ unrun: expect.stringContaining("ENOENT") });
    } finally {
      process.execPath = execPath;
    }
  });
});
