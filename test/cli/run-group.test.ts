import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { GROUP_NOT_SUPPORTED } from "../../src/core/daemon/run-group.js";
import { squealRepo } from "../harness/helpers.js";
import { closeFakeDaemons, fakeDaemon, lockStore, received } from "./fake-daemon.js";

/* Spec 019 D6, row 019-15: `squeal run <group>` asks the daemon to run one group now. */

const USAGE_TAIL = "       squeal run <group> [--wait [<ms>]]\n";

const saved = { ...process.env };
let runtimeDir: string;

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const CHECKS = [
  { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop", after: ["unit"] },
  { name: "unit", runner: "vitest", tests: ["test/**"], at: "edit" },
  { name: "lint", lint: true, at: "commit" },
];

/** A repository whose `squeal.config.json` has `checks` (none: no `checks` key). */
function repo(checks: readonly object[] | null = CHECKS) {
  const r = squealRepo();
  writeFileSync(
    join(r.root, "squeal.config.json"),
    JSON.stringify(checks === null ? {} : { checks }),
  );
  return r;
}

function group(
  name: string,
  requested: { revision: number; queued: number } | null,
  extra: { unknown?: boolean; error?: string | null } = {},
) {
  return {
    ok: true,
    type: "run-group",
    requestId: "g1",
    group: name,
    requested,
    unknown: extra.unknown ?? false,
    error: extra.error ?? null,
  };
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

const sent = () => received.filter((request) => request.type !== "ping");

describe("squeal run <group> (spec 019 D6)", () => {
  it("sends run-group and prints what the scheduler queued once it took the request", async () => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-group": [group("unit", null)],
      "run-group-status": [group("unit", null), group("unit", { revision: 5, queued: 2 })],
    });
    expect(await run(["run", "unit"], r.root)).toEqual({
      code: 0,
      stdout: "Group unit requested at revision 5: 2 test files queued; they run now.\n",
      stderr: "",
    });
    expect(sent()).toEqual([
      { type: "run-group", group: "unit" },
      { type: "run-group-status", requestId: "g1" },
      { type: "run-group-status", requestId: "g1" },
    ]);
  });

  it("names the groups a group runs after, and says when none of its files needs a run", async () => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-group": [
        group("e2e", { revision: 5, queued: 1 }),
        group("e2e", { revision: 6, queued: 0 }),
      ],
    });
    expect((await run(["run", "e2e"], r.root)).stdout).toBe(
      "Group e2e requested at revision 5: 1 test file queued; they run once unit has nothing pending.\n",
    );
    expect(await run(["run", "e2e"], r.root)).toEqual({
      code: 0,
      stdout:
        "No test files of group e2e to run at revision 6: the group has none or all are current.\n",
      stderr: "",
    });
  });

  it("runs a default group by name with no checks key, through run-group", async () => {
    const r = repo(null);
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-group": [group("slow", { revision: 2, queued: 3 })],
    });
    expect((await run(["run", "slow"], r.root)).stdout).toBe(
      "Group slow requested at revision 2: 3 test files queued; they run once tests has nothing pending.\n",
    );
    expect(sent()).toEqual([{ type: "run-group", group: "slow" }]);
  });

  it("exits 2 on an unknown name and lists the groups, asking no daemon", async () => {
    const r = repo();
    const result = await run(["run", "e2f"], r.root);
    expect(result).toMatchObject({ code: 2, stdout: "" });
    expect(result.stderr).toMatch(
      /^squeal run: no group "e2f"; the groups are e2e, unit, lint, tests and slow\nusage: squeal run --all/,
    );
    expect(result.stderr.endsWith(USAGE_TAIL)).toBe(true);
    expect((await run(["run", "e2e"], repo(null).root)).stderr.split("\n")[0]).toBe(
      'squeal run: no group "e2e"; the groups are tests and slow',
    );
    expect(sent()).toEqual([]);
  });

  it("exits 2 on another flag, or two names", async () => {
    const r = repo();
    const cases: [string[], string][] = [
      [["run", "e2e", "--force"], 'unknown argument "--force" with a group'],
      [["run", "--force", "e2e"], 'unknown argument "--force" with a group'],
      [["run", "e2e", "unit"], 'one group at a time: "e2e" and "unit"'],
    ];
    for (const [argv, problem] of cases) {
      const result = await run(argv, r.root);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.stderr.split("\n")[0], argv.join(" ")).toBe(`squeal run: ${problem}`);
      expect(result.stderr.endsWith(USAGE_TAIL), argv.join(" ")).toBe(true);
    }
    expect(sent()).toEqual([]);
  });

  it("words an older daemon's unknown-request answer, and its scheduler's refusal", async () => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-group": [
        { ok: false, error: 'unknown request type "run-group"' },
        group("e2e", null, { error: GROUP_NOT_SUPPORTED }),
      ],
    });
    for (let i = 0; i < 2; i++) {
      expect(await run(["run", "e2e"], r.root)).toEqual({
        code: 1,
        stdout: "",
        stderr: `squeal: ${GROUP_NOT_SUPPORTED}\n`,
      });
    }
    expect(await run(["run", "e2e", "--wait", "500"], r.root)).toEqual({
      code: 3,
      stdout: `No verdict: ${GROUP_NOT_SUPPORTED}\n`,
      stderr: "",
    });
  });

  it("says when the daemon's policy has no such group yet", async () => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-group": [group("e2e", null, { unknown: true })],
    });
    expect(await run(["run", "e2e"], r.root)).toEqual({
      code: 1,
      stdout: "",
      stderr:
        'squeal: the daemon\'s policy has no group "e2e" yet; it reloads squeal.config.json when it sees the file change\n',
    });
  });

  it("exits 1 without a daemon, and 3 with --wait", async () => {
    const r = repo();
    expect(await run(["run", "e2e"], r.root)).toEqual({
      code: 1,
      stdout: "",
      stderr: `squeal: no daemon running for ${r.root}; start one with squeal start\n`,
    });
    expect(await run(["run", "e2e", "--wait"], r.root)).toEqual({
      code: 3,
      stdout: `No verdict: no daemon running for ${r.root}; start one with squeal start\n`,
      stderr: "",
    });
  });

  it("prints a receipt for a request the scheduler has not taken, and no verdict with --wait", async () => {
    const r = repo();
    // Row 011-302: the status answer names what holds the request.
    const holder = {
      kind: "scheduler",
      operation: "applying revision 412",
      heldMs: 48_000,
      step: null,
    };
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-group": [group("e2e", null)],
      "run-group-status": [{ ...group("e2e", null), holder }],
    });
    expect(await run(["run", "e2e", "--wait", "300"], r.root)).toEqual({
      code: 3,
      stdout:
        "Group e2e has no verdict: the deadline passed before the daemon took request g1; it waits for the scheduler, which has been applying revision 412 for 48 s. The request stays pending: wait again with squeal run e2e --wait.\n",
      stderr: "",
    });
  });

  // Review 0.1.409 B1: a store no one can read drops only the heartbeat detail.
  it("has no verdict, in time and naming the holder, while the store is locked", async () => {
    const r = repo();
    r.daemon("stale", Date.now() - 111_000);
    const holder = { kind: "startup", heldMs: 5_000, step: null };
    await fakeDaemon(
      socketPathFor(r.worktreeId),
      {
        "run-group": [group("e2e", null)],
        "run-group-status": [{ ...group("e2e", null), holder }],
      },
      (type) => {
        // An exclusive lock on a WAL store needs every other connection closed.
        if (type === "run-group") {
          r.store.close();
          lockStore(r.repo.commonDir);
        }
      },
    );
    const started = performance.now();
    expect(await run(["run", "e2e", "--wait", "300"], r.root)).toEqual({
      code: 3,
      stdout:
        "Group e2e has no verdict: the deadline passed before the daemon took request g1; it waits for the daemon's startup, which has run for 5 s. The request stays pending: wait again with squeal run e2e --wait.\n",
      stderr: "",
    });
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
