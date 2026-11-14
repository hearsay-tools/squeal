import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { removeTree } from "./remove-tree.js";

const base = mkdtempSync(join(tmpdir(), "squeal-remove-tree-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let made = 0;
/** A new folder under `base` holding `files` files and one subfolder. */
function tree(files = 3): string {
  const dir = join(base, `t-${made++}`);
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "sub", "inner"), "x");
  for (let i = 0; i < files; i++) writeFileSync(join(dir, `f-${i}`), "x");
  return dir;
}

const errno = (code: string) => Object.assign(new Error(`${code}: test`), { code });

describe("removeTree", () => {
  // As `research/probes/enotempty-cleanup/rmsync-retry.mjs`: a second process adds files to the
  // folder by path, without making it, for a short time, as a starting process's recorder does.
  it("removes a folder another process keeps adding files to for a while", async () => {
    const dir = tree(500);
    const writer = spawn(process.execPath, [
      "-e",
      `const fs = require("fs"); const end = Date.now() + 300; let n = 0;
       const t = setInterval(() => {
         try { fs.appendFileSync(${JSON.stringify(dir)} + "/late-" + n++, "x"); } catch {}
         if (Date.now() > end) clearInterval(t);
       }, 1);`,
    ]);
    const exited = new Promise((done) => writer.on("exit", done));
    for (let waited = 0; !existsSync(join(dir, "late-0")); waited += 5) {
      if (waited > 10_000) throw new Error("the writer never wrote");
      await new Promise((done) => setTimeout(done, 5));
    }
    removeTree(dir, { timeoutMs: 10_000 });
    expect(existsSync(dir)).toBe(false);
    await exited;
    expect(existsSync(dir)).toBe(false);
  });

  it("repeats the whole removal while an attempt meets a new entry", () => {
    const dir = tree();
    const attempts: string[] = [];
    removeTree(dir, {
      intervalMs: 1,
      remove: (path) => {
        attempts.push(path);
        if (attempts.length < 3) throw errno("ENOTEMPTY");
        rmSync(path, { recursive: true, force: true });
      },
    });
    expect(attempts).toEqual([dir, dir, dir]);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes the folder again when a writer made it after a removal", () => {
    const dir = tree();
    let attempts = 0;
    removeTree(dir, {
      intervalMs: 1,
      remove: (path) => {
        rmSync(path, { recursive: true, force: true });
        if (++attempts < 3) mkdirSync(join(path, "made-again"), { recursive: true });
      },
    });
    expect(attempts).toBe(3);
    expect(existsSync(dir)).toBe(false);
  });

  it("fails at once on an error Node does not retry", () => {
    const dir = tree();
    let attempts = 0;
    const remove = () => {
      attempts++;
      throw errno("EACCES");
    };
    expect(() => removeTree(dir, { remove })).toThrow("EACCES: test");
    expect(attempts).toBe(1);
  });

  it("fails at its deadline and names what is left", () => {
    const dir = tree(1);
    const started = Date.now();
    const remove = () => {
      throw errno("ENOTEMPTY");
    };
    expect(() => removeTree(dir, { timeoutMs: 200, intervalMs: 20, remove })).toThrow(
      /was not removed in 200 ms \(\d+ attempts; last: Error: ENOTEMPTY: test\); left: f-0, sub, sub\/inner$/,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });
});
