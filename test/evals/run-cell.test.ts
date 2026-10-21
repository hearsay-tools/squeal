import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  alive,
  cellDirs,
  type FakeRoot,
  fakeRoot,
  HOST,
  leaks,
  PROXY_KEY,
  pids,
  removeRoot,
  runCell,
  STATUS_JSON,
  TOKEN,
} from "./fake-cell.js";

// Review 006-03 B1, B3 (the runner's half), S1 and S2 through the real run-cell.mjs, with fake
// harnesses, a fake Squeal and made-up credentials: no model, provider or daemon of Squeal's.
const roots: FakeRoot[] = [];
const root = () => {
  const f = fakeRoot();
  roots.push(f);
  return f;
};
afterEach(() => {
  for (const f of roots.splice(0)) removeRoot(f);
});
const CELL = ["t1-thousands", "p0"];
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const noSecretPrinted = (output: string) => {
  for (const s of [TOKEN, PROXY_KEY, HOST]) expect(output).not.toContain(s);
};

describe("run-cell.mjs with fake harnesses", { timeout: 30_000 }, () => {
  it("cleans the scratch when setup throws, and fails the cell (B1)", async () => {
    const f = root();
    const r = await runCell(f, [...CELL, "codex", "gpt-6-luna", "1"]);
    expect(r.code).toBe(1);
    noSecretPrinted(r.output);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(existsSync(join(cell, "codex"))).toBe(false);
    expect(existsSync(join(cell, "home"))).toBe(false);
    expect(leaks(f.root)).toEqual([]);
    const scratch = json(join(cell, "out/scratch.json"));
    expect(scratch.secretsAfterRemoval).toEqual([]);
    expect(readFileSync(join(cell, "out/runner.log"), "utf8")).toMatch(/exited 9/);
  });

  it("sanitizes a session's leaked credential, writes truth.json and status-end.json (B1, B3)", async () => {
    const f = root();
    const r = await runCell(f, [...CELL, "claude", "claude-haiku-5-5", "1"], {
      FAKE_HARNESS: "leak",
    });
    expect(r.code).toBe(0);
    noSecretPrinted(r.output);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(leaks(f.root)).toEqual([]);
    const scratch = json(join(cell, "out/scratch.json"));
    expect(scratch.sanitized).toEqual(
      expect.arrayContaining(["out/events.jsonl", "out/diff.patch", "work/leak.txt"]),
    );
    expect(scratch.removed).toContain("work/leak.bin");
    expect(existsSync(join(cell, "out/grade.json"))).toBe(true);
    expect(json(join(cell, "out/truth.json"))).toEqual({
      vitest: { exit: 0, signal: null, timedOut: false, spawnError: null },
      nodeTest: { exit: 0, signal: null, timedOut: false, spawnError: null, files: 1 },
    });
    expect(existsSync(join(cell, "out/truth.txt"))).toBe(false);
    expect(readFileSync(join(cell, "out/status-end.json"), "utf8")).toBe(STATUS_JSON);
    // The committed leak is in the diff against the fixture's commit, redacted.
    expect(readFileSync(join(cell, "out/diff.patch"), "utf8")).toMatch(
      /leak\.txt[\s\S]*\[redacted\]/,
    );
    for (const pid of pids(f, "daemons")) expect(alive(pid)).toBe(false);
  });

  it("fails the cell when a secret survives, and keeps no grade (B1)", async () => {
    const f = root();
    const r = await runCell(f, [...CELL, "claude", "claude-haiku-5-5", "1"], {
      FAKE_HARNESS: "locked",
    });
    expect(r.code).toBe(1);
    noSecretPrinted(r.output);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(json(join(cell, "out/scratch.json")).secretsAfterRemoval).toEqual([
      "work/locked/leak.txt",
    ]);
    expect(existsSync(join(cell, "out/grade.json"))).toBe(false);
    expect(r.output).toMatch(/secret/);
  });

  it("fails a session that cannot start, with the daemon stopped (S2)", async () => {
    const f = root();
    chmodSync(join(f.dir, "bin/claude"), 0o644);
    const r = await runCell(f, [...CELL, "claude", "claude-haiku-5-5", "1"]);
    expect(r.code).toBe(1);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(readFileSync(join(cell, "out/runner.log"), "utf8")).toMatch(/EACCES/);
    expect(pids(f, "daemons").length).toBeGreaterThan(0);
    for (const pid of pids(f, "daemons")) expect(alive(pid)).toBe(false);
    expect(existsSync(join(cell, "out/grade.json"))).toBe(false);
  });

  it("kills a session that outlives its timeout with its process group (S2)", async () => {
    const f = root();
    const r = await runCell(
      f,
      [...CELL, "claude", "claude-haiku-5-5", "1", "--timeout-s", "1", "--grace-s", "0.5"],
      { FAKE_HARNESS: "hang" },
    );
    expect(r.code).toBe(0);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(json(join(cell, "out/meta.json")).exit).toEqual({
      exit: null,
      signal: "SIGKILL",
      timedOut: true,
      spawnError: null,
    });
    for (const pid of [...pids(f, "harness"), ...pids(f, "daemons")])
      expect(alive(pid)).toBe(false);
  });

  it("tears down the session, the daemon and the scratch when the runner is terminated (S2)", async () => {
    const f = root();
    const r = await runCell(
      f,
      [...CELL, "claude", "claude-haiku-5-5", "1"],
      { FAKE_HARNESS: "hang" },
      (child) => {
        const poll = setInterval(() => {
          if (pids(f, "harness").length >= 2) {
            clearInterval(poll);
            child.kill("SIGTERM");
          }
        }, 100);
      },
    );
    expect(r.code).toBe(143);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    for (const pid of [...pids(f, "harness"), ...pids(f, "daemons")])
      expect(alive(pid)).toBe(false);
    expect(existsSync(join(cell, "home"))).toBe(false);
    expect(existsSync(join(cell, "out/scratch.json"))).toBe(true);
  });

  it("gives the session's bare squeal the pinned plugin's CLI, not the host's launcher (006-62)", async () => {
    const f = root();
    const r = await runCell(f, [...CELL, "claude", "claude-haiku-5-5", "1"], {
      FAKE_HARNESS: "squeal",
    });
    expect(r.code, r.output).toBe(0);
    // The fake Squeal in the pin answers; the host's launcher, first on its PATH, does not.
    expect(readFileSync(join(f.log, "bare"), "utf8")).toBe("Known failures: 0\n");
    // Recorded, so the atomic trend counts the cell (finding 3).
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(json(join(cell, "out/grade.json")).squealPath).toBe("pinned");
  });

  it("runs fresh by default and skips a graded cell only on --resume (S1)", async () => {
    const f = root();
    const args = [...CELL, "claude", "claude-haiku-5-5", "1"];
    expect((await runCell(f, args)).code).toBe(0);
    expect((await runCell(f, args)).code).toBe(0);
    const cells = cellDirs(f);
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(existsSync(join(c, "out/grade.json"))).toBe(true);
    const run = cells[0]?.split("/").at(-2) ?? "";
    const resumed = await runCell(f, [...args, "--run", run, "--resume"]);
    expect(resumed.code).toBe(0);
    expect(resumed.output).toMatch(/skip .*already graded/);
    const again = await runCell(f, [...args, "--run", run]);
    expect(again.code).toBe(2);
    expect(again.output).toMatch(/--resume/);
    expect(cellDirs(f)).toHaveLength(2);
    for (const c of cellDirs(f)) expect(existsSync(join(c, "out/grade.json"))).toBe(true);
  });
});
