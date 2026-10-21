import { lstatSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { psCommand } from "../../src/cli/ps.js";
import { flag } from "../../src/core/ps/flags.js";
import { fileFlags } from "../../src/core/ps/flags-files.js";
import type { PsSnapshot } from "../../src/core/ps/shape.js";
import { dirAged, HOUR, type ModelHost, modelHost, modelOf } from "./fixture-model.js";
import { fakeWindow, NOW, snapshotHost } from "./fixture-snapshot.js";

/*
 * Task 014-23, the size walk (`lessons.md` P3): it runs with `--full` only,
 * and it reads nothing when the leftovers' own links show it cannot finish.
 * `node:fs` is wrapped here, so each test can tell which paths were read.
 */

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readdirSync: vi.fn(fs.readdirSync), lstatSync: vi.fn(fs.lstatSync) };
});

const DU = "`squeal ps --leftovers | xargs -d '\\n' du -sch --` sums them";

/**
 * What was read below `dirs` since the last clear: a `readdir` of one of
 * them or below, an `lstat` below. The listing's `lstat` of each is no walk.
 */
function readBelow(dirs: readonly string[]): string[] {
  const below = (path: string, self: boolean) =>
    dirs.some((dir) => (self && path === dir) || path.startsWith(`${dir}${sep}`));
  return [
    ...vi
      .mocked(readdirSync)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => below(path, true)),
    ...vi
      .mocked(lstatSync)
      .mock.calls.map(([path]) => String(path))
      .filter((path) => below(path, false)),
  ];
}

function clearReads(): void {
  vi.mocked(readdirSync).mockClear();
  vi.mocked(lstatSync).mockClear();
}

/** An old key directory with `files` files of 5 bytes and `subdirs` empty subdirectories. */
function leftover(host: ModelHost, key: string, files: number, subdirs = 0): string {
  const dir = join(host.userDir, "tmp", key);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < files; i++) writeFileSync(join(dir, `f${i}`), "12345");
  for (let i = 0; i < subdirs; i++) mkdirSync(join(dir, `d${i}`));
  // `dirAged` writes its own file of 10 bytes, after which the directory is aged.
  return dirAged(dir, 2 * HOUR);
}

describe("the size walk of leftover-temp", () => {
  let host: ModelHost;
  beforeEach(() => {
    host = modelHost();
  });
  afterEach(() => {
    rmSync(host.base, { recursive: true, force: true });
  });

  it("reads nothing below a leftover without --full, and unknown names the size with the du command", () => {
    const dir = leftover(host, "00000000000000aa", 3);
    const model = modelOf({ host });
    clearReads();
    const findings = flag(model);
    expect(findings.leftovers).toEqual([dir]);
    expect(findings.files[0]?.bytes).toBeNull();
    expect(readBelow([dir])).toEqual([]);
    expect(findings.unknown).toContainEqual({
      what: "files leftover-temp bytes",
      why: `the size walk runs with --full only; ${DU}`,
    });
  });

  it("sums the files below the leftovers with --full", () => {
    const dir = leftover(host, "00000000000000aa", 3, 1);
    const findings = flag(modelOf({ host }), { full: true });
    expect(findings.files[0]?.bytes).toBe(3 * 5 + 10);
    expect(findings.unknown.map((u) => u.what)).not.toContain("files leftover-temp bytes");
    expect(findings.leftovers).toEqual([dir]);
  });

  // A directory's links count its subdirectories on ext4, xfs and tmpfs, where this runs; btrfs gives 1.
  it("reads nothing below the leftovers with --full when their own subdirectory links pass the bound", () => {
    const a = leftover(host, "00000000000000aa", 0, 2);
    const b = leftover(host, "00000000000000bb", 0, 2);
    const model = modelOf({ host });
    clearReads();
    const past = fileFlags(model, { full: true, sizeEntries: 3 });
    expect(past.leftovers).toEqual([a, b]);
    expect(past.files[0]?.bytes).toBeNull();
    expect(readBelow([a, b])).toEqual([]);
    expect(past.unknown).toContainEqual({
      what: "files leftover-temp bytes",
      why: `the size walk stops at 3 entries; ${DU}`,
    });
    // Their 4 links do not pass 6, so the walk runs and finishes: 4 subdirectories and 2 files.
    clearReads();
    expect(fileFlags(model, { full: true, sizeEntries: 6 }).files[0]?.bytes).toBe(20);
    expect(readBelow([a, b])).not.toEqual([]);
  });
});

describe("squeal ps and the size walk", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function ps(args: readonly string[]): Promise<{ shape: PsSnapshot; read: string[] }> {
    const host = snapshotHost();
    try {
      const dir = join(host.places.tempDir, `squeal-${host.places.uid}`, "tmp", "00000000000000aa");
      mkdirSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "sub", "log"), "1234567");
      writeFileSync(join(dir, "run"), "123");
      utimesSync(dir, new Date(NOW - 2 * HOUR), new Date(NOW - 2 * HOUR));
      const window = fakeWindow();
      let stdout = "";
      const io: CliIo = {
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
        cwd: host.base,
        now: window.now,
        env: { HOME: host.places.home, XDG_RUNTIME_DIR: host.places.runtimeDir ?? "" },
      };
      clearReads();
      // The real flags, as the command has them: `--full` reaches the walk through its wrapper.
      await psCommand(args, io, {
        platform: "linux",
        sourceFor: () => host.source,
        wait: window.wait,
        tempDir: host.places.tempDir,
        uid: host.places.uid,
      });
      return { shape: JSON.parse(stdout) as PsSnapshot, read: readBelow([dir]) };
    } finally {
      rmSync(host.base, { recursive: true, force: true });
    }
  }

  it("ps --json reads no entry below a leftover, and ps --full --json sums it", async () => {
    const plain = await ps(["--json"]);
    expect(plain.shape.files.find((f) => f.flag === "leftover-temp")).toMatchObject({
      count: 1,
      bytes: null,
    });
    expect(plain.read).toEqual([]);
    const full = await ps(["--full", "--json"]);
    expect(full.shape.files.find((f) => f.flag === "leftover-temp")).toMatchObject({
      count: 1,
      bytes: 10,
    });
    expect(full.read).not.toEqual([]);
  });
});
