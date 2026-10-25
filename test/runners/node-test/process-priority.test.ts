import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { TEST_NICE } from "../../../src/core/daemon/low-priority.js";
import { startGroup } from "../../../src/runners/process/group.js";

/*
 * 001 D11 Capacity, Priority (task 001-378): a node:test or pytest process
 * runs at `nice` 10 from its start, and what it spawns inherits it. Run at
 * `nice` 10 already (under a lowered daemon), the check holds trivially.
 */

const REPORTS = `const { spawnSync } = require("node:child_process");
const { getPriority } = require("node:os");
const child = spawnSync(process.execPath, ["-p", "require('node:os').getPriority()"], { encoding: "utf8" });
console.log(JSON.stringify({ own: getPriority(), child: Number(child.stdout.trim()) }));
`;

describe("startGroup: test processes at nice 10 (001-378)", () => {
  it("starts the process at nice 10, and its child inherits it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sq-001-378-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const group = startGroup({
      command: process.execPath,
      args: ["-e", REPORTS],
      cwd: dir,
      env: process.env,
      stdout: join(dir, "out"),
      stderr: join(dir, "err"),
    });
    expect(await group.exited).toEqual({ code: 0, signal: null, error: null });
    expect(JSON.parse(readFileSync(join(dir, "out"), "utf8"))).toEqual({
      own: TEST_NICE,
      child: TEST_NICE,
    });
  });
});
