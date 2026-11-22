import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/*
 * Row 024-04 (spec 024 D4.4, review 0.1.600 B1): a multi-kind load resolves a symlink target
 * once across `f`, `m` and `d`, and never retains a stale symlink target across test files or
 * filesystem mutations.
 */

type Realpath = (abs: string) => string;
const RECORDER = fileURLToPath(
  new URL("../../../src/runners/observe/recorder.cjs", import.meta.url),
);
const { resolveOnce } = createRequire(import.meta.url)(RECORDER) as {
  resolveOnce: (realpath: Realpath, abs: string) => () => string | null;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the recorder's per-load realpath resolution", () => {
  it("asks the system once for one resolution call and handles errors without throwing", () => {
    const asked: string[] = [];
    const ok = resolveOnce((abs) => {
      asked.push(abs);
      return `/real${abs}`;
    }, "/a");
    expect([ok(), ok(), ok()]).toEqual(["/real/a", "/real/a", "/real/a"]);
    expect(asked).toEqual(["/a"]);

    const missing = resolveOnce(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }, "/gone");
    expect([missing(), missing()]).toEqual([null, null]);
  });

  it("still records a module loaded through a link with its target", { timeout: 60_000 }, () => {
    const seen = observe(
      { "main.cjs": 'require("./linked/lib.cjs");\n', "real/lib.cjs": "module.exports = {};\n" },
      "main.cjs",
      { links: { linked: "real" } },
    );
    expect(seen.paths).toEqual(
      expect.arrayContaining(["linked/lib.cjs", "main.cjs", "real/lib.cjs"]),
    );
  });

  it("observes the new symlink target when a link is retargeted between test files (review 0.1.600 B1)", () => {
    const root = mkdtempSync(join(tmpdir(), "squeal-retarget-"));
    const out = mkdtempSync(join(tmpdir(), "squeal-retarget-out-"));
    dirs.push(root, out);
    writeFileSync(join(root, "a.txt"), "A");
    writeFileSync(join(root, "b.txt"), "B");
    symlinkSync("a.txt", join(root, "link"));

    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      globalThis.__vitest_worker__ = { filepath: path.resolve("first.test.js") };
      const first = fs.readFileSync("link", "utf8");
      globalThis.__vitest_worker__ = undefined;
      fs.unlinkSync("link");
      fs.symlinkSync("b.txt", "link");
      globalThis.__vitest_worker__ = { filepath: path.resolve("second.test.js") };
      const second = fs.readFileSync("link", "utf8");
      process.stdout.write(first + " " + second);
    `;
    const stdout = execFileSync(process.execPath, ["-e", script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${JSON.stringify(RECORDER)}`,
        SQUEAL_OBSERVE: JSON.stringify({ out, root, skip: [], started: false }),
      },
    });
    expect(stdout).toBe("A B");

    const byFile = new Map<string, Set<string>>();
    for (const name of readdirSync(out)) {
      const lines = readFileSync(join(out, name), "utf8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const entry = JSON.parse(line) as { t: string; f?: string[] };
        const set = byFile.get(entry.t) ?? new Set<string>();
        for (const p of entry.f ?? []) set.add(relative(root, p));
        byFile.set(entry.t, set);
      }
    }
    const firstSeen = [...(byFile.get(resolve(root, "first.test.js")) ?? [])].sort();
    const secondSeen = [...(byFile.get(resolve(root, "second.test.js")) ?? [])].sort();
    expect(firstSeen).toEqual(["a.txt", "link"]);
    expect(secondSeen).toEqual(["b.txt", "link"]);
  });
});
