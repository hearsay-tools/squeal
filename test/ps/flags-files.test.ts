import { createHash } from "node:crypto";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import { fileFlags } from "../../src/core/ps/flags-files.js";
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

  it("quotes a path with a space and a quote in its rm", () => {
    const path = join(host.base, "it's a dir", `squeal-${ID}.sock`);
    const [file] = flag(modelOf({ host, sockets: [socket({ path })] })).files;
    expect(file?.command).toBe(`rm '${host.base}/it'\\''s a dir/squeal-${ID}.sock'`);
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

  it("lists only the names Squeal makes, each as the code that makes it names it (lessons.md P1)", () => {
    const tmp = host.places.tempDir;
    const made = [
      keyDir("00000000000000aa"), // daemon/scratch.ts
      keyDir("00000000000000bb.old-0a1b2c3d"), // daemon/scratch.ts, moved aside
      join(tmp, `squeal-${UID}-00000000000000cc-AbC123`), // daemon/scratch.ts, the fallback
      join(tmp, "squeal-e2e-AbC123"), // test/e2e/harness.ts
      join(tmp, "squeal-e2e-oc-AbC123"), // test/e2e/opencode-fixture.ts
      join(tmp, "squeal-e2e-pi-AbC123"), // test/e2e/pi-fixture.ts
      join(tmp, "squeal-update-AbC123"), // cli/update.ts
    ].map((dir) => dirAged(dir, 2 * HOUR, 3));
    for (const dir of [
      join(tmp, "squeal-review-x"),
      join(tmp, "squeal-review-014-13-r2"),
      join(tmp, `squeal-evals-${UID}`),
      join(tmp, "squeal-e2e-cache"),
      join(tmp, "squeal-e2e-AbC12"),
      join(tmp, "squeal-e2e-AbC1234"),
      join(tmp, "squeal-update-AbC-12"),
      join(tmp, `squeal-${UID}-00000000000000cc`),
      join(tmp, `squeal-${UID + 1}-00000000000000cc-AbC123`),
      join(tmp, "squeal-001-428-1001"),
      join(tmp, "sq-AbC123"),
      keyDir("not-a-key"),
      keyDir("00000000000000AA"),
      keyDir("00000000000000aa.old-x"),
    ])
      dirAged(dir, 2 * HOUR, 3);
    const findings = flag(modelOf({ host }));
    expect(findings.leftovers).toEqual(made.sort());
    expect(findings.files[0]?.count).toBe(made.length);
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

  it.each([
    ["a space", " b"],
    ["a single quote", "'s"],
    ["a double quote", ' "hi"'],
    ["an equals sign", "=b"],
    ["a colon", ":b"],
  ])(
    "a name with %s is used whole as a working directory, an argument or an <option>=<path>; the name it starts with is not (reviews/wave-2.md B2)",
    (_, suffix) => {
      const dirs = (u: number) => [
        join(host.places.tempDir, `squeal-e2e-AbC12${u}`),
        keyDir(`00000000000000a${u}`),
      ];
      const uses = [
        (dir: string) => ({ cwd: dir }),
        (dir: string) => ({ cmdline: ["cat", join(dir, "file")] }),
        (dir: string) => ({ cmdline: ["node", `--dir=${dir}`] }),
      ];
      const processes = uses.flatMap((use, u) =>
        dirs(u).map((dir, d) => ({
          pid: 700 + 2 * u + d,
          ...use(dirAged(`${dir}${suffix}`, 2 * HOUR)),
        })),
      );
      const unused = uses.flatMap((_, u) => dirs(u).map((dir) => dirAged(dir, 2 * HOUR)));
      expect(flag(modelOf({ host, processes })).leftovers).toEqual(unused.sort());
    },
  );

  it("reads a use under the temp directory's real path, as the kernel gives a working directory", () => {
    const link = join(host.base, "tmp-link");
    symlinkSync(host.places.tempDir, link);
    const places = { ...host.places, tempDir: link };
    dirAged(join(host.places.tempDir, "squeal-e2e-cwdAAA"), 2 * HOUR);
    dirAged(join(host.places.tempDir, "squeal-e2e-argAAA"), 2 * HOUR);
    dirAged(keyDir("00000000000000aa"), 2 * HOUR);
    dirAged(join(host.places.tempDir, "squeal-e2e-freeAA"), 2 * HOUR);
    const processes = [
      { pid: 700, cwd: join(host.places.tempDir, "squeal-e2e-cwdAAA", "sub") },
      { pid: 701, cmdline: ["node", `--dir=${join(host.places.tempDir, "squeal-e2e-argAAA")}`] },
      { pid: 702, cwd: keyDir("00000000000000aa") },
    ];
    const findings = flag(modelOf({ host: { ...host, places }, processes }));
    expect(findings.leftovers).toEqual([join(link, "squeal-e2e-freeAA")]);
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
    // Aged again: the files moved its mtime to the real clock, which is past the fixture's.
    dirAged(dir, 2 * HOUR);
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
