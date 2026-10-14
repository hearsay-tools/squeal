import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { install, machine, piDirOf, type Result } from "../cli/install-fixture.js";
import { atGate, gateCall, lastMessage, type PiWorld } from "../harness/pi/real-pi.js";
import { piBase, piUnavailable, runPi, textOf } from "../helpers/pi.js";
import { copyPlugin } from "./plugins.js";

/*
 * Spec 009 D1, the limit of keeping one previous version (review 009-22 S2):
 * a real Pi session that loaded the shipped package from the directory
 * `install.sh` unpacked, in a project where Squeal is not set up, so no
 * daemon names that directory. `install.sh --pi` of two later releases (the
 * scratch machine's local archives) runs while the session is open: the first
 * keeps the package, the second removes it under the session. The message
 * says so before it happens.
 */

const unavailable = piUnavailable();
if (unavailable && process.env.CI) throw new Error(`Pi unavailable on CI: ${unavailable}`);

const RELOAD =
  "Pi sessions already open keep the Squeal they loaded; /reload in each loads 1.0.1. " +
  "Reload them before the next update: it removes the version they loaded unless its daemon is running\n";

describe.skipIf(unavailable !== undefined)("an open Pi session across two updates", () => {
  it("keeps its package through one update, loses it to the second, and is told to /reload first", {
    timeout: 120_000,
  }, async () => {
    // Directory names only order the versions; the open session's holds the shipped package.
    const m = machine(["pi"]);
    m.publish("1.0.0");
    expect(install(m).status).toBe(0);
    const old = piDirOf(m);
    rmSync(old, { recursive: true });
    copyPlugin("pi", old);
    const cli = join(old, "dist/cli/squeal.mjs");

    const marks = mkdtempSync(join(piBase(), "squeal-pi-update-"));
    const world: PiWorld = {
      env: { SQUEAL_TEST_MARKS: marks },
      marks,
      spawnedDaemon: () => false,
    };
    const updates: Result[] = [];
    let keptAfterFirst = false;
    let finished = false;
    const pi = runPi({
      mode: "rpc",
      prompts: ["work"],
      install: [old],
      env: world.env,
      plan: [
        { tools: [gateCall(0)] },
        // The primer's command for the CLI it loaded, run after both updates.
        {
          tools: [
            { name: "bash", arguments: { command: `"${process.execPath}" "${cli}" --version` } },
          ],
        },
        { text: "done" },
      ],
    }).finally(() => {
      finished = true;
    });
    const beside = atGate(
      world,
      0,
      () => finished,
      () => {
        m.publish("1.0.1");
        updates.push(install(m, "--pi"));
        keptAfterFirst = existsSync(cli);
        m.publish("1.0.2");
        updates.push(install(m, "--pi"));
      },
    );
    const [run] = await Promise.all([pi, beside]);
    try {
      const [first, second] = updates;
      expect(first?.status, first?.stderr).toBe(0);
      expect(first?.stdout).toContain(RELOAD);
      expect(keptAfterFirst).toBe(true);
      expect(second?.status, second?.stderr).toBe(0);
      expect(second?.stdout).toContain(`$ rm -rf ${old}\n`);
      expect(existsSync(old)).toBe(false);

      // Pi itself goes on; the package it loaded is gone under it.
      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.events.some((e) => e.type === "extension_error")).toBe(false);
      const [, , after] = run.requests;
      expect(lastMessage(after)).toMatchObject({ role: "toolResult", isError: true });
      expect(textOf(lastMessage(after))).toContain("MODULE_NOT_FOUND");
    } finally {
      run.cleanup();
      rmSync(marks, { recursive: true, force: true });
    }
  });
});
