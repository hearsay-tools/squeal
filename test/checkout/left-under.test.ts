import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCheckout, removeCheckout } from "../../src/core/checkout/checkout.js";
import { endLeftUnder, leftUnderText } from "../../src/core/checkout/left-under.js";
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

/** A detached process that idles until signalled; `ignoreTerm` makes it outlast SIGTERM. */
function idle(cwd: string, args: readonly string[] = [], ignoreTerm = false): ChildProcess {
  const code = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}setInterval(() => {}, 1000);`;
  const script = args.length > 0 && args[0]?.endsWith(".js") === true;
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
  const last = `\0${child.spawnargs.at(-1)}\0`;
  for (let i = 0; i < 100; i++) {
    try {
      if (execFileSync("cat", [`/proc/${pid}/cmdline`], { encoding: "utf8" }).endsWith(last))
        return pid;
    } catch {}
    await delay(20);
  }
  return pid;
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
    // Outside by cwd, under by an argument (a browser's `--user-data-dir`).
    const browser = await started(idle(base, [`--user-data-dir=${checkout.run}/profile`]));
    // Outside by cwd and by a path that only shares the folder's prefix.
    mkdirSync(`${checkout.folder}2`);
    const outside = await started(idle(`${checkout.folder}2`, [`${checkout.folder}2/x`]));
    const notes: string[] = [];
    await removeCheckout(checkout, { note: (text) => notes.push(text) });
    expect(existsSync(checkout.folder)).toBe(false);
    expect(alive(server)).toBe(false);
    expect(alive(browser)).toBe(false);
    expect(alive(outside)).toBe(true);
    expect(notes).toEqual(["ended 2 processes left under the checkout (cezar serve, node)"]);
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
    const stubborn = await started(idle(folder, [], true));
    const uid = process.getuid?.() as number;
    // Seen as another user's: never signalled.
    expect(await endLeftUnder(folder, { uid: uid + 1, graceMs: 100 })).toEqual({
      ended: [],
      running: [],
    });
    expect(alive(stubborn)).toBe(true);
    // The process given as the caller, and its ancestors, are spared.
    expect(await endLeftUnder(folder, { self: stubborn, graceMs: 100 })).toEqual({
      ended: [],
      running: [],
    });
    expect(alive(stubborn)).toBe(true);
    const left = await endLeftUnder(folder, { graceMs: 200 });
    expect(left).toEqual({ ended: [{ pid: stubborn, name: "node" }], running: [] });
    expect(alive(stubborn)).toBe(false);
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
    expect(leftUnderText(null)).toBeNull();
    expect(leftUnderText({ ended: [], running: [{ pid: 3, name: "chrome" }] })).toBe(
      "1 process under the checkout still running after SIGKILL (chrome)",
    );
  });
});
