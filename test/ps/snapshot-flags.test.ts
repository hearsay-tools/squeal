import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flag } from "../../src/core/ps/flags.js";
import type { Flag, PsModel } from "../../src/core/ps/model.js";
import type { PsFlag } from "../../src/core/ps/shape.js";
import { takeSnapshot } from "../../src/core/ps/snapshot.js";
import { writeHostRules } from "./fixture-host-rules.js";
import { fakeWindow, type SnapshotHost, snapshotHost } from "./fixture-snapshot.js";
import {
  daemonProcess,
  type FixtureRepo,
  lockLine,
  makeRepo,
  writeProcesses,
} from "./fixture-stores.js";

/*
 * Spec 014 D7 through the assembled snapshot (`reviews/wave-2.md` B1, B2 and
 * input 2): the real `flag` over the model the window builds, never a
 * stand-in. The second sample holds Squeal's processes only, so a rule of
 * the whole host must read the first.
 */

let host: SnapshotHost;
let alpha: FixtureRepo;

beforeEach(() => {
  host = snapshotHost();
  alpha = makeRepo(host.base, "alpha");
  host.serve(800, alpha);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(host.base, { recursive: true, force: true });
});

async function snap(f: Flag = flag) {
  const window = fakeWindow();
  return takeSnapshot({
    source: host.source,
    places: host.places,
    flag: f,
    full: false,
    repo: false,
    sampleMs: 2_000,
    now: window.now,
    wait: window.wait,
  });
}

describe("the host-wide rules read the whole host (reviews/wave-2.md B1)", () => {
  test("a waiter whose parent is gone is an orphan-waiter; one whose parent lives is not", async () => {
    const rules = writeHostRules(host);
    const real = vi.fn(flag);
    const shape = await snap(real);
    // The second sample is the daemon's alone: the waiters are in the first only.
    const model = real.mock.calls[0]?.[0] as PsModel;
    expect([...model.second.sample.table.keys()]).toEqual([800]);
    expect(shape.orphans).toEqual([
      {
        pid: rules.goneParent,
        comm: "node",
        startedAt: expect.any(Number),
        flags: [
          {
            flag: "orphan-waiter",
            reason: "its parent 999 is gone",
            command: `kill ${rules.goneParent}`,
          },
        ],
      },
    ]);
    expect(shape.orphans.map((o) => o.pid)).not.toContain(rules.liveParent);
  });
});

describe("a held lock one /proc/locks read misses (lessons.md P9)", () => {
  // The fixture's bundle is not on disk, so each daemon is `install-gone` too.
  const lockClaims = (flags: readonly PsFlag[] = []) =>
    flags.filter((f) => f.flag === "no-lock" || f.flag === "duplicate");

  /** What one `/proc/locks` reading shows: 800's lock and permit, none, or no file to read. */
  type Reading = "held" | "empty" | "unreadable";

  /**
   * Daemon 800 holds its lock and permit `pool.0.lock`, and its socket file is
   * there; 801, of the same root, holds no lock. `/proc/locks` reads as
   * `first` at the window's start and as `second` at its end.
   */
  async function window(first: Reading, second: Reading) {
    const pool = join(host.places.runtimeDir ?? "", "squeal");
    mkdirSync(pool);
    writeFileSync(join(pool, "pool.0.lock"), "");
    const socket = join(host.places.runtimeDir ?? "", `squeal-${alpha.id}.sock`);
    writeFileSync(socket, "");
    writeProcesses(host, [daemonProcess({ pid: 801, root: alpha.root })]);
    const locks = join(host.base, "proc", "locks");
    const permit = lockLine(2, 800, host.source.fileKey(join(pool, "pool.0.lock")) ?? "");
    const held = `${readFileSync(locks, "utf8")}${permit}\n`;
    const read = (r: Reading) =>
      r === "unreadable"
        ? rmSync(locks, { force: true })
        : writeFileSync(locks, r === "held" ? held : "");
    read(first);
    const w = fakeWindow(() => read(second));
    const shape = await takeSnapshot({
      source: host.source,
      places: host.places,
      flag,
      full: false,
      repo: false,
      sampleMs: 2_000,
      now: w.now,
      wait: w.wait,
    });
    return { shape, socket };
  }

  for (const first of ["empty", "held"] as const)
    test(`${first === "empty" ? "the first reading misses it, the second shows it" : "both readings show it"}: 800 serves with its work, socket and permit, and only 801 is waiting, no-lock and the duplicate`, async () => {
      const { shape } = await window(first, "held");
      const daemons = new Map(shape.repositories.flatMap((r) => r.daemons).map((d) => [d.pid, d]));
      expect(daemons.get(800)).toMatchObject({ phase: "serving", state: "serving", permits: 1 });
      expect(daemons.get(800)?.work.pending).not.toBeNull();
      expect(lockClaims(daemons.get(800)?.flags)).toEqual([]);
      expect(daemons.get(801)).toMatchObject({ phase: "waiting", permits: 0 });
      expect(lockClaims(daemons.get(801)?.flags)).toEqual([
        {
          flag: "no-lock",
          reason: "it has waited 65 s for its lock, past 40 s",
          command: "kill 801",
        },
        {
          flag: "duplicate",
          reason: `daemon 800 holds the lock of its root ${alpha.root}`,
          command: "kill 801",
        },
      ]);
      expect(shape.files.filter((f) => f.flag === "stale-socket")).toEqual([]);
      expect(shape.squeal.pool).toMatchObject({ held: 1 });
      expect(shape.unknown.filter((u) => u.what === "daemon 800 work")).toEqual([]);
      expect(shape.unknown.filter((u) => u.what === "daemon lock holders")).toEqual([]);
    });

  // `reviews/wave-5.md` B1: only two readable readings that both miss a lock prove it absent.
  for (const [first, second] of [
    ["empty", "unreadable"],
    ["unreadable", "held"],
    ["unreadable", "empty"],
  ] as const)
    test(`${first} then ${second}: no daemon is waiting or no-lock, no socket is stale, no end command names a lock, and the holders and permits are unknown`, async () => {
      const { shape } = await window(first, second);
      const daemons = shape.repositories.flatMap((r) => r.daemons);
      expect(daemons.map((d) => d.pid).sort()).toEqual([800, 801]);
      for (const d of daemons) {
        expect(d.phase).not.toBe("waiting");
        expect(lockClaims(d.flags)).toEqual([]);
        expect(d.permits).toBeNull();
      }
      expect(daemons.find((d) => d.pid === 800)?.phase).toBe("serving");
      expect(shape.files.filter((f) => f.flag === "stale-socket")).toEqual([]);
      expect(shape.squeal.pool.held).toBeNull();
      const [lost, other] = first === "unreadable" ? ["first", "second"] : ["second", "first"];
      const why = `the window's ${lost} /proc/locks reading cannot be read, so a lock the ${other} misses is unknown, not absent`;
      expect(shape.unknown).toContainEqual({
        what: "daemon lock holders",
        why: `${why}: a phase is serving by its heartbeat, or unknown`,
      });
      for (const what of ["flag no-lock", "flag hung", "flag foreign-permit", "phase stopping"])
        expect(shape.unknown).toContainEqual({
          what,
          why: "one of the window's two /proc/locks readings cannot be read, so a lock the other misses is unknown, not absent",
        });
      expect(shape.unknown).toContainEqual({
        what: "daemon 801 flag duplicate",
        why: `whether it holds a lock of its root ${alpha.root} is unknown`,
      });
    });

  test("a lock both readings miss: the daemon waits, is no-lock past 40 s, and its socket is stale", async () => {
    const locks = join(host.base, "proc", "locks");
    writeFileSync(locks, "");
    const socket = join(host.places.runtimeDir ?? "", `squeal-${alpha.id}.sock`);
    writeFileSync(socket, "");
    const shape = await snap();
    const daemon = shape.repositories[0]?.daemons.find((d) => d.pid === 800);
    expect(daemon).toMatchObject({ phase: "waiting" });
    expect(lockClaims(daemon?.flags).map((f) => [f.flag, f.command])).toEqual([
      ["no-lock", "kill 800"],
    ]);
    expect(shape.files.filter((f) => f.flag === "stale-socket").map((f) => f.path)).toEqual([
      socket,
    ]);
    expect(shape.squeal.pool).toMatchObject({ held: 0 });
  });
});
