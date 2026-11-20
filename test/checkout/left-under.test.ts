import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCheckout, removeCheckout } from "../../src/core/checkout/checkout.js";
import {
  endLeftUnder,
  endScanned,
  leftUnderNote,
  leftUnderText,
  scanLeftUnder,
} from "../../src/core/checkout/left-under.js";
import { sweepCheckouts } from "../../src/core/checkout/sweep.js";

/*
 * Row 023-31 (spec 023 D6, round 4 R6): before a checkout is removed, the
 * processes of this user left under it end and the note names them; a
 * process outside the path, or another user's, is left running.
 */

const linux = existsSync("/proc/self/stat");
let base: string;
let repo: string;
let commonDir: string;
const children: ChildProcess[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A detached process that idles until signalled. */
function idle(cwd: string, args: readonly string[] = []): ChildProcess {
  const code = "setInterval(() => {}, 1000);";
  const script = args[0] !== undefined && existsSync(args[0]);
  const child = spawn(process.execPath, script ? args : ["-e", code, "--", ...args], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const stat = execFileSync("cat", [`/proc/${pid}/stat`], { encoding: "utf8" });
  return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
}

/**
 * Waits until a just-spawned child runs its own command: before its exec,
 * a forked child shows its parent's command line.
 */
async function started(child: ChildProcess): Promise<number> {
  const pid = child.pid as number;
  const own = `${child.spawnargs.join("\0")}\0`;
  for (let i = 0; i < 100; i++) {
    try {
      if (execFileSync("cat", [`/proc/${pid}/cmdline`], { encoding: "utf8" }) === own) return pid;
    } catch {}
    await delay(20);
  }
  return pid;
}

/**
 * A detached process that ignores SIGTERM, once its handler is in place: it
 * writes a ready file after it installs the handler. (Node's native layer
 * catches SIGTERM from its start, so `SigCgt` does not tell.)
 */
async function stubborn(cwd: string): Promise<number> {
  const ready = join(base, `ready-${children.length}`);
  const code = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(ready)}, ""); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["-e", code], { cwd, detached: true, stdio: "ignore" });
  children.push(child);
  for (let i = 0; i < 250 && !existsSync(ready); i++) await delay(20);
  return child.pid as number;
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-left-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "one");
  commonDir = realpathSync(join(repo, ".git"));
});

afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      process.kill(child.pid as number, "SIGKILL");
    } catch {}
  }
  rmSync(base, { recursive: true, force: true });
});

describe.runIf(linux)("processes left under a removed checkout", () => {
  it("are ended and named before the checkout goes; one outside the path runs on", async () => {
    const dir = join(base, "checkouts");
    const checkout = await createCheckout({ root: repo, commonDir, commit: "HEAD", dir });
    // `cezar/dist/index.js serve` with its cwd in the tree: named "cezar serve".
    const script = join(base, "tools", "cezar", "dist", "index.js");
    mkdirSync(join(base, "tools", "cezar", "dist"), { recursive: true });
    writeFileSync(script, "setInterval(() => {}, 1000);\n");
    const server = await started(idle(checkout.tree, [script, "serve"]));
    // Its cwd in the checkout through a symlink: the kernel reports the real path.
    symlinkSync(checkout.folder, join(base, "alias"));
    const aliased = await started(idle(join(base, "alias", "run")));
    // The human, 2026-11-21 ("A: working folder only"): no argument counts.
    const browser = await started(idle(base, [`--user-data-dir=${checkout.run}/profile`]));
    // Outside by cwd: a sibling whose name only starts with the folder's.
    mkdirSync(`${checkout.folder}2`);
    const sibling = await started(idle(`${checkout.folder}2`));
    // Re-review B1 witnesses. A: a link in the checkout that leads out, then `..`
    // to a missing leaf, as an argument, and as the cwd itself.
    mkdirSync(join(base, "external"));
    symlinkSync(join(base, "external"), join(checkout.run, "out"));
    const dotDot = await started(idle(base, [`${checkout.run}/out/../missing`]));
    const linkedOut = await started(idle(join(checkout.run, "out")));
    // B: an executable whose path holds the checkout's path after a space.
    const cat = join(base, `outside ${checkout.folder}`, "run", "cat");
    mkdirSync(join(cat, ".."), { recursive: true });
    copyFileSync("/bin/cat", cat);
    chmodSync(cat, 0o755);
    const spaced = spawn(cat, [], {
      cwd: base,
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    children.push(spaced);
    const withSpace = await started(spaced);
    // The checkout's path embedded in another path.
    const embedded = await started(idle(base, [`/another-root${checkout.folder}/file.js`]));
    const notes: string[] = [];
    await removeCheckout(checkout, { note: (text) => notes.push(text) });
    expect(existsSync(checkout.folder)).toBe(false);
    expect(alive(server)).toBe(false);
    expect(alive(aliased)).toBe(false);
    const survivors = { browser, sibling, dotDot, linkedOut, withSpace, embedded };
    for (const [name, pid] of Object.entries(survivors)) expect(alive(pid), name).toBe(true);
    expect(notes).toEqual(["ended 2 processes left under the checkout (cezar serve, node)"]);
  });

  it("are ended when their working folder, or the whole checkout, is already deleted", async () => {
    const folder = join(base, "folder");
    mkdirSync(join(folder, "gone"), { recursive: true });
    const inGone = await started(idle(join(folder, "gone")));
    rmSync(join(folder, "gone"), { recursive: true });
    expect(await endLeftUnder(folder, { graceMs: 200 })).toEqual({
      ended: [{ pid: inGone, name: "node" }],
      running: [],
    });
    expect(alive(inGone)).toBe(false);
    const inFolder = await started(idle(folder));
    rmSync(folder, { recursive: true });
    expect(await endLeftUnder(folder, { graceMs: 200 })).toEqual({
      ended: [{ pid: inFolder, name: "node" }],
      running: [],
    });
    expect(alive(inFolder)).toBe(false);
  });

  it("are ended by the sweep of a dead owner's checkout", async () => {
    const dir = join(base, "checkouts");
    const checkout = await createCheckout({ root: repo, commonDir, commit: "HEAD", dir });
    const marker = join(checkout.folder, "marker.json");
    const read = JSON.parse(execFileSync("cat", [marker], { encoding: "utf8" }));
    // An owner pid no process holds: the checkout is a dead owner's.
    writeFileSync(marker, JSON.stringify({ ...read, owner: { ...read.owner, pid: 2 ** 22 + 7 } }));
    const left = await started(idle(checkout.tree));
    const notes: string[] = [];
    const swept = await sweepCheckouts({ commonDir, dirs: [dir], note: (t) => notes.push(t) });
    expect(swept.map((s) => s.folder)).toEqual([checkout.folder]);
    expect(alive(left)).toBe(false);
    expect(notes).toEqual(["ended 1 process left under the checkout (node)"]);
  });

  it("kills one that outlasts SIGTERM, and leaves another user's and its own caller", async () => {
    const folder = join(base, "folder");
    mkdirSync(folder);
    const term = await stubborn(folder);
    const uid = process.getuid?.() as number;
    // Seen as another user's: never signalled.
    expect(await endLeftUnder(folder, { uid: uid + 1, graceMs: 100 })).toEqual({
      ended: [],
      running: [],
    });
    expect(alive(term)).toBe(true);
    // The process given as the caller, and its ancestors, are spared.
    expect(await endLeftUnder(folder, { self: term, graceMs: 100 })).toEqual({
      ended: [],
      running: [],
    });
    expect(alive(term)).toBe(true);
    const left = await endLeftUnder(folder, { graceMs: 200 });
    expect(left).toEqual({ ended: [{ pid: term, name: "node" }], running: [] });
    expect(alive(term)).toBe(false);
  });
});

describe("the report line", () => {
  it("counts each name once, in the order first seen", () => {
    const chrome = Array.from({ length: 15 }, (_, i) => ({ pid: 10 + i, name: "chrome" }));
    const ended = [{ pid: 1, name: "cezar serve" }, ...chrome, { pid: 2, name: "agent-browser" }];
    expect(leftUnderText({ ended, running: [] })).toBe(
      "ended 17 processes left under the checkout (cezar serve, chrome ×15, agent-browser)",
    );
    expect(leftUnderText({ ended: [], running: [] })).toBeNull();
    expect(leftUnderText({ ended: [], running: [{ pid: 3, name: "chrome" }] })).toBe(
      "1 process under the checkout still running after SIGKILL (chrome)",
    );
  });
});

describe("a skipped or failed scan", () => {
  it("is told once when no /proc can be read, and a failure each time", async () => {
    const empty = mkdtempSync(join(tmpdir(), "squeal-noproc-"));
    try {
      expect(await endLeftUnder(empty, { root: empty })).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    expect(leftUnderNote(null)).toMatch(
      /^did not look for processes left under the checkout: \w+ has no \/proc to read/,
    );
    expect(leftUnderNote(null)).toBeNull();
    expect(leftUnderNote(new Error("EACCES"))).toBe(
      "could not look for processes left under the checkout: EACCES",
    );
    expect(leftUnderNote({ ended: [], running: [] })).toBeNull();
  });
});

/** A `/proc` entry for `pid` under `root`: its stat with `start`, its cwd and its arguments. */
function fakeProc(root: string, pid: number, start: string, cwd: string): void {
  const dir = join(root, "proc", String(pid));
  mkdirSync(dir, { recursive: true });
  const fields = ["S", "1", ...Array(17).fill("0"), start, "0"];
  writeFileSync(join(dir, "stat"), `${pid} (node) ${fields.join(" ")}\n`);
  writeFileSync(join(dir, "cmdline"), "node\0-e\0x\0");
  writeFileSync(join(dir, "comm"), "node\n");
  rmSync(join(dir, "cwd"), { force: true });
  symlinkSync(cwd, join(dir, "cwd"));
}

describe.runIf(linux)("the check before SIGTERM (review wave-18 note 1)", () => {
  it("skips a process whose start time, or path, changed since the scan", async () => {
    const folder = join(base, "folder");
    mkdirSync(folder);
    const pid = await started(idle(base));
    fakeProc(base, pid, "100", folder);
    const scanned = scanLeftUnder(folder, { root: base });
    expect(scanned?.found.map((f) => f.pid)).toEqual([pid]);
    // Another process took the pid: another start time.
    fakeProc(base, pid, "200", folder);
    expect(await endScanned(scanned as NonNullable<typeof scanned>, { root: base })).toEqual({
      ended: [],
      running: [],
    });
    expect(alive(pid)).toBe(true);
    // The same process, no longer under the folder.
    fakeProc(base, pid, "100", base);
    expect(await endScanned(scanned as NonNullable<typeof scanned>, { root: base })).toEqual({
      ended: [],
      running: [],
    });
    expect(alive(pid)).toBe(true);
  });

  it("checks again before SIGKILL: one that left the folder in the grace is not killed", async () => {
    const folder = join(base, "folder");
    mkdirSync(folder);
    const pid = await stubborn(base);
    fakeProc(base, pid, "100", folder);
    const scanned = scanLeftUnder(folder, { root: base });
    // It ignores SIGTERM; during the grace its working folder moves out.
    setTimeout(() => fakeProc(base, pid, "100", base), 100);
    const left = await endScanned(scanned as NonNullable<typeof scanned>, {
      root: base,
      graceMs: 400,
    });
    expect(left).toEqual({ ended: [], running: [{ pid, name: "node" }] });
    expect(alive(pid)).toBe(true);
  });
});
