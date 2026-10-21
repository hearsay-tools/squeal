import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureProcess } from "./fixture.js";
import { NOW, type SnapshotHost } from "./fixture-snapshot.js";
import { NODE, writeProcesses } from "./fixture-stores.js";

/*
 * Spec 014 D7's host-wide rules (`reviews/wave-2.md` B1): `leftover-temp`'s
 * use check and `orphan-waiter` read every process of the host, which the
 * second sample, Squeal's processes only, does not hold. None of the
 * processes here is Squeal's, so only the first sample has them.
 */

const HOUR = 60 * 60_000;

/** A directory with one file, its mtime `ageMs` before the snapshot's clock, set after its contents. */
export function oldDir(path: string, ageMs = 2 * HOUR): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "file"), "x");
  const at = new Date(NOW - ageMs);
  utimesSync(path, at, at);
  return path;
}

/** An ordinary process of this user: no mark, not Node. */
function plain(pid: number, ppid: number, over: Partial<FixtureProcess>): FixtureProcess {
  return {
    pid,
    ppid,
    pgid: pid,
    comm: "bash",
    nice: 0,
    ageS: 600,
    lifeCpuPct: 1,
    cmdline: ["bash"],
    environ: {},
    ...over,
  };
}

/** A slot waiter of a session: `node <bundle>/dist/waiter.mjs`. */
function waiter(pid: number, ppid: number): FixtureProcess {
  return plain(pid, ppid, {
    comm: "node",
    cmdline: [NODE, "/home/user/.claude/plugins/cache/hearsay/squeal/0.1.240/dist/waiter.mjs"],
  });
}

export interface HostRules {
  /** Every directory `--leftovers` lists, sorted. */
  readonly leftovers: readonly string[];
  /** The waiter whose parent is gone, and the one whose parent lives. */
  readonly goneParent: number;
  readonly liveParent: number;
}

/**
 * Old directories under the temp directory and its key directory: one a
 * process works in, one an argument names, one an `<option>=<path>`
 * argument names, and one nobody uses; the same with a space, both quotes,
 * `=` and `:` in the name (`reviews/wave-2.md` B2), each beside an unused
 * neighbor its name starts with; and two waiters, one whose parent is gone
 * and one whose parent lives.
 */
export function writeHostRules(host: SnapshotHost): HostRules {
  const tmp = host.places.tempDir;
  const keys = join(tmp, `squeal-${host.places.uid}`, "tmp");
  const cwd = oldDir(join(tmp, "squeal-e2e-cwd"));
  const arg = oldDir(join(tmp, "squeal-e2e-arg"));
  const option = oldDir(join(tmp, "squeal-e2e-opt"));
  const key = oldDir(join(keys, "00000000000000aa"));
  const free = oldDir(join(tmp, "squeal-e2e-free"));
  const freeKey = oldDir(join(keys, "00000000000000bb"));
  // A working directory below the leftover: the subdirectory is made first, then the leftover aged.
  mkdirSync(join(cwd, "work"));
  oldDir(cwd);
  const space = oldDir(join(tmp, "squeal-e2e-a b"));
  const equals = oldDir(join(tmp, "squeal-e2e-a=b"));
  const colon = oldDir(join(tmp, "squeal-e2e-a:b"));
  const single = oldDir(join(tmp, "squeal-e2e-it's"));
  const double = oldDir(join(tmp, 'squeal-e2e-say "hi"'));
  const quotedKey = oldDir(join(keys, `00000000000000cc it's "a=b:c"`));
  const colonKey = oldDir(join(keys, "00000000000000dd a:b"));
  const neighbors = [
    oldDir(join(tmp, "squeal-e2e-a")),
    oldDir(join(tmp, "squeal-e2e-it")),
    oldDir(join(tmp, "squeal-e2e-say")),
    oldDir(join(keys, "00000000000000cc")),
    oldDir(join(keys, "00000000000000dd")),
  ];
  writeProcesses(host, [
    plain(700, 1, { cwd: join(cwd, "work") }),
    plain(701, 1, { cmdline: ["bash", join(arg, "run.sh")] }),
    plain(702, 1, {
      comm: "python3",
      cmdline: ["python3", "-m", "pytest", `--basetemp=${option}`],
    }),
    plain(703, 1, { cwd: key }),
    plain(704, 1, { cwd: space }),
    plain(705, 1, { comm: "node", cmdline: [NODE, `--dir=${equals}`] }),
    plain(706, 1, { cmdline: ["ls", colon] }),
    plain(707, 1, { cmdline: ["cat", join(single, "x")] }),
    plain(708, 1, { cwd: double }),
    plain(709, 1, { cmdline: ["vitest", `--root=${join(quotedKey, "sub")}`] }),
    plain(710, 1, { cwd: colonKey }),
    waiter(720, 999),
    plain(722, 1, {}),
    waiter(721, 722),
  ]);
  return {
    leftovers: [free, freeKey, ...neighbors].sort(),
    goneParent: 720,
    liveParent: 721,
  };
}
