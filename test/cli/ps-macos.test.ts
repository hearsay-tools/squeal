import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { psCommand } from "../../src/cli/ps.js";
import { createDarwinSource } from "../../src/core/ps/darwin.js";
import { flag } from "../../src/core/ps/flags.js";
import type { PsSnapshot } from "../../src/core/ps/shape.js";
import { outsideGit } from "../harness/bundle-helpers.js";
import { fakeWindow } from "../ps/fixture-snapshot.js";
import { type FixtureHost, makeHost } from "../ps/fixture-stores.js";

/*
 * Spec 014 D1 and D10 through the command (`reviews/wave-2.md` B4): the
 * macOS source over fixture outputs, with the real flags. A `ps` that
 * fails, first or second, is no snapshot and exits 3; a `ps` that lists
 * no process is a host without daemons.
 */

const FIXTURES = join(import.meta.dirname, "..", "ps", "fixtures", "darwin");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
/** The user whose daemons `ps-1.txt` lists. */
const UID = 501;
const NO_SNAPSHOT =
  "squeal ps: no snapshot: the process table cannot be read: ps failed, is missing or timed out\n";

let host: FixtureHost;
beforeEach(() => {
  host = makeHost();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

/** `squeal ps <args>` on macOS, each `ps` giving the next of `tables`; `null` fails it. */
async function ps(args: string[], tables: readonly (string | null)[]) {
  const window = fakeWindow();
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const source = createDarwinSource({
    run: (command) => {
      if (command === "env") return tables[calls++] ?? null;
      if (command === "vm_stat") return fixture("vm_stat.txt");
      if (command === "sysctl") return fixture("swapusage.txt");
      throw new Error(`unexpected command: ${command}`);
    },
    now: window.now,
    os: {
      loadavg: () => [1, 1, 1],
      totalmem: () => 16 * 1024 ** 3,
      cpus: () => [],
      availableParallelism: () => 8,
      uptime: () => 600_000,
    },
  });
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: outsideGit(),
    now: window.now,
    env: { HOME: host.places.home },
  };
  const code = await psCommand(args, io, {
    platform: "darwin",
    sourceFor: () => source,
    flag,
    wait: window.wait,
    tempDir: host.places.tempDir,
    uid: UID,
  });
  return { code, stdout, stderr, calls };
}

describe("squeal ps on macOS when ps fails (reviews/wave-2.md B4)", () => {
  test("a failed first ps is no snapshot: exit 3, never an empty host", async () => {
    const { code, stdout, stderr, calls } = await ps(["--json"], [null]);
    expect({ code, stdout, stderr, calls }).toEqual({
      code: 3,
      stdout: "",
      stderr: NO_SNAPSHOT,
      calls: 1,
    });
  });

  test("a failed second ps is no snapshot: exit 3", async () => {
    const { code, stdout, stderr, calls } = await ps([], [fixture("ps-1.txt"), null]);
    expect({ code, stdout, stderr, calls }).toEqual({
      code: 3,
      stdout: "",
      stderr: NO_SNAPSHOT,
      calls: 2,
    });
  });

  test("a ps that lists no process is a host without daemons, exit 0", async () => {
    const text = await ps([], [""]);
    expect([text.code, text.stderr]).toEqual([0, ""]);
    expect(text.stdout).toContain("\nNo Squeal daemon runs.\n");
    const json = await ps(["--json"], [""]);
    expect((JSON.parse(json.stdout) as PsSnapshot).squeal.daemons).toBe(0);
  });

  test("two tables that read: a snapshot of the user's daemons", async () => {
    const { code, stdout, calls } = await ps(
      ["--json"],
      [fixture("ps-1.txt"), fixture("ps-2.txt")],
    );
    expect(code).not.toBe(3);
    expect(calls).toBe(2);
    expect((JSON.parse(stdout) as PsSnapshot).squeal.daemons).toBe(2);
  });
});
