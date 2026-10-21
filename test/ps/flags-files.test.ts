import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import { fileFlags, shellQuote } from "../../src/core/ps/flags-files.js";
import type { SocketFile } from "../../src/core/ps/model.js";
import {
  dirAged,
  foundDaemon,
  HOUR,
  type ModelHost,
  makeRoot,
  modelHost,
  modelOf,
  NOW,
  UID,
  workOf,
  writeAged,
} from "./fixture-model.js";

/* Spec 014 D7, the files: each flag's flagged case and the healthy one it could take for it. */

let host: ModelHost;
beforeEach(() => {
  host = modelHost();
});
afterEach(() => {
  rmSync(host.base, { recursive: true, force: true });
});

const ID = "fd5a859b8ca77ef9";

function socket(over: Partial<SocketFile> = {}): SocketFile {
  return {
    path: join(host.places.runtimeDir ?? "", `squeal-${ID}.sock`),
    worktreeId: ID,
    mtimeMs: Date.UTC(2026, 9, 16, 20, 36),
    daemonPid: null,
    listening: false,
    ...over,
  };
}

describe("stale-socket", () => {
  it("flags a socket file no live daemon of its id holds, with its date and rm", () => {
    const s = socket();
    const findings = flag(modelOf({ host, sockets: [s] }));
    expect(findings.files).toEqual([
      {
        flag: "stale-socket",
        reason: `no live daemon of worktree ${ID} holds its lock; changed 2026-10-16 20:36 UTC`,
        path: s.path,
        count: 1,
        bytes: 0,
        command: `rm ${s.path}`,
      },
    ]);
  });

  it("leaves the socket of a live lock holder alone", () => {
    const findings = flag(modelOf({ host, sockets: [socket({ daemonPid: 4100 })] }));
    expect(findings.files).toEqual([]);
  });

  it("never flags a socket a process listens at, and names it unknown", () => {
    const s = socket({ listening: true });
    const findings = flag(modelOf({ host, sockets: [s] }));
    expect(findings.files).toEqual([]);
    expect(findings.unknown).toContainEqual({
      what: `socket ${s.path}`,
      why: `a process listens at it, but no daemon of worktree ${ID} was found`,
    });
  });

  it("quotes a path with a space and a quote so the shell reads it back whole", () => {
    const dir = join(host.base, "it's a dir");
    mkdirSync(dir);
    const path = join(dir, `squeal-${ID}.sock`);
    writeFileSync(path, "");
    const [file] = flag(modelOf({ host, sockets: [socket({ path })] })).files;
    expect(file?.command).toBe(`rm '${dir.replace("'", "'\\''")}/squeal-${ID}.sock'`);
    const echoed = execFileSync("sh", ["-c", `printf %s ${shellQuote(path)}`], {
      encoding: "utf8",
    });
    expect(echoed).toBe(path);
  });
});

describe("stale-pool-mark", () => {
  const pool = () => join(host.places.runtimeDir ?? "", "squeal");

  it("flags a mark older than 30 s in either pool directory", () => {
    const stale = writeAged(join(pool(), "pool.mark.0011223344556677"), 31_000, "{}\n");
    const other = writeAged(join(host.userDir, "pool.mark.8899aabbccddeeff"), HOUR);
    const findings = flag(modelOf({ host }));
    expect(findings.files.map((f) => [f.flag, f.path, f.command])).toEqual([
      ["stale-pool-mark", other, `rm ${other}`],
      ["stale-pool-mark", stale, `rm ${stale}`],
    ]);
    expect(findings.files[1]?.bytes).toBe(3);
    expect(findings.files[1]?.reason).toMatch(/readers skip a mark older than 30 s$/);
  });

  it("leaves a fresh mark and a mark being written alone", () => {
    writeAged(join(pool(), "pool.mark.0011223344556677"), 29_000);
    writeAged(join(pool(), "pool.mark.0011223344556677.tmp"), HOUR);
    expect(flag(modelOf({ host })).files).toEqual([]);
  });
});

describe("leftover-temp", () => {
  const keyDir = (key: string) => join(host.userDir, "tmp", key);
  /** A live daemon of a repository with an id, so its temp key is known. */
  function liveDaemon(pid: number) {
    const { root, commonDir } = makeRoot(host, `repo-${pid}`);
    writeAged(join(commonDir, "squeal", "repository-id"), 0, `repo-id-${pid}\n`);
    const key = createHash("sha256").update(`repo-id-${pid}\0${root}`).digest("hex").slice(0, 16);
    const daemon = foundDaemon({ pid, root, commonDir });
    return { daemon, key, entry: { daemon, first: workOf(daemon) } };
  }

  it("groups the old key and squeal-* directories no daemon or process uses, and lists each", () => {
    const a = dirAged(keyDir("00000000000000aa"), 2 * HOUR, 100);
    const b = dirAged(keyDir("00000000000000bb.old-1a2b3c4d"), 3 * HOUR, 20);
    const e2e = dirAged(join(host.places.tempDir, "squeal-e2e-Ab12Cd"), 5 * HOUR, 7);
    const findings = flag(modelOf({ host }));
    expect(findings.leftovers).toEqual([a, b, e2e].sort());
    expect(findings.files).toEqual([
      {
        flag: "leftover-temp",
        reason: `3 directories under ${host.places.tempDir} that no live daemon's key names and no process uses, unchanged for over 1 h; the oldest since ${new Date(NOW - 5 * HOUR).toISOString().slice(0, 16).replace("T", " ")} UTC`,
        path: null,
        count: 3,
        bytes: 127,
        command: "squeal ps --leftovers | xargs -d '\\n' rm -rf --",
      },
    ]);
  });

  it("leaves a live daemon's key, its moved-aside copy and its own fallback directory alone", () => {
    const live = liveDaemon(4100);
    dirAged(keyDir(live.key), 5 * HOUR);
    dirAged(keyDir(`${live.key}.old-00ff00ff`), 5 * HOUR);
    dirAged(join(host.places.tempDir, `squeal-${UID}-${live.key}-Xy12Zq`), 5 * HOUR);
    const findings = flag(modelOf({ host, daemons: [live.entry] }));
    expect(findings.leftovers).toEqual([]);
    expect(findings.files).toEqual([]);
  });

  it("leaves a directory changed within the hour, and squeal-<uid> itself, alone", () => {
    dirAged(keyDir("00000000000000aa"), 59 * 60_000);
    expect(flag(modelOf({ host })).leftovers).toEqual([]);
  });

  it("leaves a directory a process works in or names in an argument alone", () => {
    const cwd = dirAged(keyDir("00000000000000aa"), 2 * HOUR);
    const arg = dirAged(join(host.places.tempDir, "squeal-e2e-Ab12Cd"), 2 * HOUR);
    const free = dirAged(join(host.places.tempDir, "squeal-e2e-Zz99Yy"), 2 * HOUR);
    const processes = [
      { pid: 700, cwd: join(cwd, "sub") },
      { pid: 701, cmdline: ["node", `--basetemp=${arg}/pytest`, "x.py"] },
    ];
    const findings = flag(modelOf({ host, processes }));
    expect(findings.leftovers).toEqual([free]);
  });

  it("is not evaluated without working directories, nor with a daemon of unknown key", () => {
    dirAged(keyDir("00000000000000aa"), 2 * HOUR);
    const blind = flag(modelOf({ host, cwds: false }));
    expect(blind.leftovers).toEqual([]);
    expect(blind.unknown).toContainEqual({
      what: "flag leftover-temp",
      why: "the working directories of processes cannot be read (D10)",
    });
    const relative = foundDaemon({ pid: 4200, root: null, commonDir: null });
    const unkeyed = flag(modelOf({ host, daemons: [{ daemon: relative, first: null }] }));
    expect(unkeyed.leftovers).toEqual([]);
    expect(unkeyed.unknown).toContainEqual({
      what: "flag leftover-temp",
      why: "the temp key of daemon 4200 is unknown: its root or repository cannot be read",
    });
  });

  it("never lists a name with a newline, since --leftovers is read a line at a time", () => {
    dirAged(join(host.places.tempDir, "squeal-x\nhome"), 2 * HOUR);
    expect(flag(modelOf({ host })).leftovers).toEqual([]);
  });

  it("names the size unknown past the walk's bound instead of a partial sum", () => {
    const dir = dirAged(keyDir("00000000000000aa"), 2 * HOUR);
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}`), "12345");
    const model = modelOf({ host });
    expect(fileFlags(model, 6).files[0]?.bytes).toBe(35);
    const past = fileFlags(model, 5);
    expect(past.files[0]?.bytes).toBeNull();
    expect(past.unknown).toEqual([
      {
        what: "files leftover-temp bytes",
        why: "the size walk stopped at 5 entries; `squeal ps --leftovers | xargs -d '\\n' du -sch --` sums them",
      },
    ]);
  });

  it("walks 3,500 leftover directories within the bound", () => {
    const n = 3_500;
    for (let i = 0; i < n; i++) dirAged(keyDir(i.toString(16).padStart(16, "0")), 2 * HOUR, 40);
    const live = liveDaemon(4100);
    const processes = Array.from({ length: 650 }, (_, i) => ({
      pid: 10_000 + i,
      cwd: `/home/user/p${i}`,
      cmdline: ["node", `/home/user/p${i}/index.js`, "--flag"],
    }));
    const model = modelOf({ host, daemons: [live.entry], processes });
    const wall = performance.now();
    const cpu = process.cpuUsage();
    const findings = flag(model);
    const used = process.cpuUsage(cpu);
    const cpuMs = (used.user + used.system) / 1000;
    const wallMs = performance.now() - wall;
    expect(findings.leftovers).toHaveLength(n);
    expect(findings.files[0]?.bytes).toBe(n * 40);
    // The bound catches a walk that grows with the candidates times the texts, not load.
    expect(cpuMs).toBeLessThan(1_000);
    expect(wallMs).toBeLessThan(5_000);
  });
});

describe("unflagged files", () => {
  it("counts lock, waiter lock, surplus permit and session-root files, and flags none", () => {
    const { root, commonDir } = makeRoot(host, "alpha");
    const daemon = foundDaemon({ pid: 4100, root, commonDir });
    const locks = join(commonDir, "squeal", "locks");
    for (const name of ["00000000000000aa.sqlite", "00000000000000bb.sqlite"])
      writeAged(join(locks, name));
    for (const i of [1, 2, 3, 4]) writeAged(join(locks, `waiter-${i}.sqlite`));
    const pool = join(host.places.runtimeDir ?? "", "squeal");
    for (const i of [0, 11, 12, 22]) writeAged(join(pool, `pool.${i}.lock`));
    writeAged(join(host.places.runtimeDir ?? "", "squeal-sessions", "a1b2"));
    const findings = flag(modelOf({ host, daemons: [{ daemon, first: workOf(daemon) }] }));
    expect(findings.unflagged).toEqual([
      { kind: "lock", count: 2 },
      { kind: "waiter-lock", count: 4 },
      { kind: "surplus-permit", count: 2 },
      { kind: "session-root", count: 1 },
    ]);
    expect(findings.files).toEqual([]);
  });
});
