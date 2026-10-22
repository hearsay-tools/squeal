import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import type { SocketFile } from "../../src/core/ps/model.js";
import {
  foundDaemon,
  HOUR,
  type ModelHost,
  makeRoot,
  modelHost,
  modelOf,
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
