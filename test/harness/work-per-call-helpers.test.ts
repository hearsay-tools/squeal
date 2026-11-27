import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CodeStatus } from "../../src/core/types/code-delivery.js";
import type { StatusResult } from "../../src/core/types/status.js";
import { countEnded, runCounted } from "./work-per-call-helpers.js";

const code = (pending: number, files: number): CodeStatus => ({
  v: 1,
  threshold: 20,
  over: 0,
  sinceRegistration: 0,
  since: null,
  pending,
  files,
  unknown: 0,
});
const snapshot = (of?: CodeStatus) =>
  ({ available: true, ...(of === undefined ? {} : { code: of }) }) as unknown as StatusResult;

describe("countEnded (review 025-wave6 S1)", () => {
  it("waits while files are not counted yet", () => {
    expect(countEnded(snapshot(code(55, 55)), 50)).toBe(false);
    expect(countEnded(snapshot(code(1, 55)), 50)).toBe(false);
  });

  it("waits while no file is admitted, or fewer than the floor", () => {
    expect(countEnded(snapshot(code(0, 0)), 50)).toBe(false);
    expect(countEnded(snapshot(code(0, 49)), 50)).toBe(false);
  });

  it("waits while the status has no count or the daemon did not answer", () => {
    expect(countEnded(snapshot(), 50)).toBe(false);
    const unavailable = { available: false, reason: "timeout" } as unknown as StatusResult;
    expect(countEnded(unavailable, 50)).toBe(false);
  });

  it("ends once every admitted file is counted", () => {
    expect(countEnded(snapshot(code(0, 55)), 50)).toBe(true);
  });
});

describe("runCounted (review 025-wave6 S2)", () => {
  const env = { PATH: process.env.PATH ?? "" };

  it("removes its counter directory after reading the counts", async () => {
    const run = await runCounted(
      ["-e", "process.stdout.write(process.env.SQUEAL_WORK_COUNTS)"],
      "",
      env,
      tmpdir(),
    );
    expect(run.code).toBe(0);
    expect(run.work.processes).toBe(1);
    expect(run.stdout).toMatch(/^\/tmp\/sq-work-/);
    expect(existsSync(run.stdout)).toBe(false);
  });

  it("rejects when the counts cannot be read, and still removes the directory", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sq-work-test-"));
    try {
      const named = join(scratch, "dir");
      const script = [
        'const { writeFileSync } = require("node:fs");',
        "const dir = process.env.SQUEAL_WORK_COUNTS;",
        "writeFileSync(process.argv[1], dir);",
        'writeFileSync(dir + "/broken.json", "{");',
      ].join("\n");
      await expect(runCounted(["-e", script, named], "", env, tmpdir())).rejects.toThrow(
        SyntaxError,
      );
      expect(existsSync(readFileSync(named, "utf8"))).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("rejects when the process cannot start", async () => {
    await expect(runCounted(["-e", ""], "", env, "/nonexistent/sq-work-cwd")).rejects.toThrow(
      /ENOENT/,
    );
  });
});
