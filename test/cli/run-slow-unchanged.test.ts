import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { squealRepo } from "../harness/helpers.js";
import { closeFakeDaemons, fakeDaemon, received } from "./fake-daemon.js";

/*
 * Row 019-15: `run --slow`, `run` without a lane and the `run-slow` request
 * as they were before `squeal run <group>`, recorded byte for byte. A
 * repository with no `checks` key sees these texts unchanged.
 */

const USAGE =
  "usage: squeal run --all|--fast [--force] [--wait [<ms>]]\n       squeal run --slow [--wait <ms>]\n";

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

const slow = (requested: { revision: number; queued: number } | null) => ({
  ok: true,
  type: "run-slow",
  requestId: "s1",
  requested,
  error: null,
});

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

describe("run --slow and run's usage, as before squeal run <group> (row 019-15)", () => {
  it("sends the same run-slow request and prints the same lines", async () => {
    const r = squealRepo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [slow({ revision: 5, queued: 2 })],
    });
    expect(await run(["run", "--slow"], r.root)).toEqual({
      code: 0,
      stdout:
        "Slow tier requested at revision 5: 2 slow files queued; they run once no fast work is pending.\n",
      stderr: "",
    });
    expect(received.filter((request) => request.type !== "ping")).toEqual([{ type: "run-slow" }]);
  });

  it("prints the same usage errors, byte for byte", async () => {
    const r = squealRepo();
    const cases: [string[], string][] = [
      [["run"], "--all, --fast or --slow is required"],
      [["run", "--slow", "--force"], 'unknown argument "--force" with --slow'],
      [["run", "--slow", "--wait"], "--wait takes a whole number of milliseconds"],
      [["run", "--all", "e2e"], 'unknown argument "e2e"'],
      [["run", "--fast", "--slow", "e2e"], 'unknown argument "e2e"'],
      [["run", "--all", "--bogus"], 'unknown argument "--bogus"'],
    ];
    for (const [argv, problem] of cases) {
      expect(await run(argv, r.root), argv.join(" ")).toEqual({
        code: 2,
        stdout: "",
        stderr: `squeal run: ${problem}\n${USAGE}`,
      });
    }
  });

  it("parses run-slow and run-slow-status as before", () => {
    expect(parseRequest('{"type":"run-slow"}')).toEqual({ type: "run-slow" });
    expect(parseRequest('{"type":"run-slow","group":"e2e"}')).toEqual({ type: "run-slow" });
    expect(parseRequest('{"type":"run-slow-status","requestId":"s1"}')).toEqual({
      type: "run-slow-status",
      requestId: "s1",
    });
  });
});
