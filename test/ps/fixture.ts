import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Fixture `/proc` trees for the ps reader (spec 014 D11, task 014-04). The
 * values come from the 014-02 probe logs
 * (`research/probes/process-measurement/logs/snapshot-1.txt` and
 * `snapshot-3-nosmaps.json`, 2026-10-21 08:14 to 08:17 UTC): pids, parents,
 * groups, nice, ages, lifetime CPU, memory in kB, marks and command lines.
 * Paths are anonymized: `/home/agent` is `/home/user`, the uid is 1000 and
 * the projects are `alpha` and `beta`.
 */

export const CLOCK_TICKS = 100;
/** `btime` of the fixture host, in seconds. */
export const BOOT_SECONDS = 1_792_000_000;
/** Seconds since boot when the fixture was taken. */
export const UPTIME_SECONDS = 600_000;

export interface FixtureProcess {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly comm: string;
  readonly state?: string;
  readonly nice: number;
  readonly ageS: number;
  /** Lifetime CPU in percent of one CPU, from the probe's `lifeCpuPct`. */
  readonly lifeCpuPct: number;
  /** The ticks of the children it waited for (`cutime + cstime`); none by default. */
  readonly childTicks?: number;
  readonly cmdline: readonly string[];
  /** `null`: no environ file; `"unreadable"`: mode 000, as another user's is. */
  readonly environ?: Readonly<Record<string, string>> | "unreadable" | null;
  /** kB, as `/proc/<pid>/status` prints them; absent for a kernel thread. */
  readonly memoryKb?: { readonly anon: number; readonly shmem: number; readonly swap: number };
  readonly fds?: Readonly<Record<number, string>>;
}

export function startTicksOf(p: FixtureProcess): number {
  return (UPTIME_SECONDS - p.ageS) * CLOCK_TICKS;
}

/** User CPU ticks; system ticks are a third of them. */
export function cpuTicksOf(p: FixtureProcess): { utime: number; stime: number } {
  const total = Math.round((p.lifeCpuPct / 100) * p.ageS * CLOCK_TICKS);
  const stime = Math.floor(total / 3);
  return { utime: total - stime, stime };
}

/** All 52 fields of `proc(5)`'s `stat`, the unused ones as the kernel would print them. */
export function statLine(p: FixtureProcess): string {
  const { utime, stime } = cpuTicksOf(p);
  const after = [
    p.state ?? "S",
    p.ppid,
    p.pgid,
    p.pgid,
    0,
    -1,
    4194560,
    1200,
    0,
    3,
    0,
    utime,
    stime,
    (p.childTicks ?? 0) - Math.floor((p.childTicks ?? 0) / 4),
    Math.floor((p.childTicks ?? 0) / 4),
    20 + p.nice,
    p.nice,
    12,
    0,
    startTicksOf(p),
    1_312_301_056,
    39_869,
  ];
  while (after.length < 50) after.push(0);
  return `${p.pid} (${p.comm}) ${after.join(" ")}\n`;
}

function statusText(p: FixtureProcess): string {
  const lines = [
    `Name:\t${p.comm}`,
    `State:\t${p.state ?? "S"} (sleeping)`,
    `Pid:\t${p.pid}`,
    `PPid:\t${p.ppid}`,
  ];
  const m = p.memoryKb;
  if (m !== undefined) {
    lines.push(
      `VmRSS:\t${String(m.anon + m.shmem + 56_868).padStart(8)} kB`,
      `RssAnon:\t${String(m.anon).padStart(8)} kB`,
      `RssFile:\t${String(56_868).padStart(8)} kB`,
      `RssShmem:\t${String(m.shmem).padStart(8)} kB`,
      `VmSwap:\t${String(m.swap).padStart(8)} kB`,
    );
  }
  lines.push("Threads:\t12");
  return `${lines.join("\n")}\n`;
}

export function writeProcess(root: string, p: FixtureProcess): void {
  const dir = join(root, "proc", String(p.pid));
  mkdirSync(join(dir, "fd"), { recursive: true });
  writeFileSync(join(dir, "stat"), statLine(p));
  writeFileSync(join(dir, "status"), statusText(p));
  writeFileSync(join(dir, "cmdline"), p.cmdline.map((a) => `${a}\0`).join(""));
  if (p.environ !== null) {
    const env =
      p.environ === "unreadable" ? { SQUEAL_DAEMON_CHILD: "hidden:vitest" } : (p.environ ?? {});
    const bytes = Object.entries(env)
      .map(([k, v]) => `${k}=${v}\0`)
      .join("");
    writeFileSync(join(dir, "environ"), bytes);
    if (p.environ === "unreadable") chmodSync(join(dir, "environ"), 0o000);
  }
  for (const [fd, target] of Object.entries(p.fds ?? {})) symlinkSync(target, join(dir, "fd", fd));
}

const HOME = "/home/user";
const NODE = `${HOME}/.nvm/versions/node/v24.21.0/bin/node`;
export const ALPHA_ID = "1e2484abf6bcdf96";
export const BETA_ID = "a3bb036f6e31e64f";
const ALPHA_LOCK = `${HOME}/projects/alpha/.git/squeal/locks/${ALPHA_ID}.sqlite`;
const daemonArgs = (harness: string, version: string, root: string): string[] => [
  NODE,
  `${HOME}/.${harness}/plugins/cache/hearsay/squeal/${version}/dist/cli/squeal.mjs`,
  "daemon",
  root,
];
export const ALPHA_MARK = "81287f79-65c7-4cd3-b2cb-547bba728456:slow:vitest";
export const BETA_MARK = "6500d1d2-7ae8-4039-a08e-1b231205f5c8:vitest";

/** Snapshot 3's first daemon, snapshot 3's busy daemon with a fork worker, snapshot 1's escaped Chrome. */
export const PROCESSES: readonly FixtureProcess[] = [
  {
    pid: 1049,
    ppid: 1,
    pgid: 1049,
    comm: "systemd",
    nice: 0,
    ageS: 590_000,
    lifeCpuPct: 0.1,
    cmdline: ["/usr/lib/systemd/systemd", "--user"],
    memoryKb: { anon: 3_100, shmem: 0, swap: 0 },
  },
  {
    pid: 349493,
    ppid: 1049,
    pgid: 349493,
    comm: "MainThread",
    nice: 0,
    ageS: 2453,
    lifeCpuPct: 1.6,
    cmdline: daemonArgs("claude", "0.1.235", `${HOME}/projects/alpha`),
    environ: { HOME, PATH: "/usr/bin", SECRET_TOKEN: "do-not-print" },
    memoryKb: { anon: 102_608, shmem: 0, swap: 0 },
    fds: {
      0: "/dev/null",
      3: ALPHA_LOCK,
      4: `${HOME}/projects/alpha/.git/squeal/store.sqlite`,
      5: "socket:[1057291937]",
    },
  },
  {
    pid: 2091490,
    ppid: 1049,
    pgid: 2091490,
    comm: "MainThread",
    nice: 0,
    ageS: 343,
    lifeCpuPct: 25,
    cmdline: daemonArgs("codex", "0.1.234", `${HOME}/projects/beta`),
    memoryKb: { anon: 665_208, shmem: 512, swap: 2_048 },
    fds: { 3: `${HOME}/projects/beta/.git/squeal/locks/${BETA_ID}.sqlite` },
  },
  {
    pid: 2353452,
    ppid: 2091490,
    pgid: 2091490,
    comm: "MainThread",
    nice: 10,
    ageS: 7,
    lifeCpuPct: 41.4,
    cmdline: [
      NODE,
      "--experimental-import-meta-resolve",
      `${HOME}/projects/beta/node_modules/vitest/dist/workers/forks.js`,
    ],
    environ: { NODE_ENV: "test", SQUEAL_DAEMON_CHILD: BETA_MARK, VITEST: "true" },
    memoryKb: { anon: 153_188, shmem: 0, swap: 0 },
  },
  {
    pid: 2353500,
    ppid: 2353452,
    pgid: 2091490,
    comm: "git",
    nice: 10,
    ageS: 1,
    lifeCpuPct: 30,
    cmdline: ["git", "status", "--porcelain"],
    environ: { GIT_DIR: "/tmp/x" },
    memoryKb: { anon: 4_000, shmem: 0, swap: 0 },
  },
  {
    pid: 2242955,
    ppid: 1049,
    pgid: 2242955,
    comm: "chrome",
    nice: 10,
    ageS: 40,
    lifeCpuPct: 15.1,
    cmdline: ["/usr/bin/google-chrome", "--remote-debugging-port=0", "--no-first-run"],
    environ: {
      SQUEAL_DAEMON_CHILD: ALPHA_MARK,
      SQUEAL_DAEMON_CHILD_COPY: "x",
      XSQUEAL_DAEMON_CHILD: "y",
    },
    memoryKb: { anon: 81_000, shmem: 26_000, swap: 0 },
  },
  {
    pid: 1200,
    ppid: 1,
    pgid: 1200,
    comm: "sshd",
    nice: 0,
    ageS: 590_000,
    lifeCpuPct: 0,
    cmdline: ["sshd: /usr/sbin/sshd"],
    environ: "unreadable",
    memoryKb: { anon: 2_000, shmem: 0, swap: 0 },
  },
  {
    pid: 2,
    ppid: 0,
    pgid: 0,
    comm: "kthreadd",
    nice: 0,
    ageS: 600_000,
    lifeCpuPct: 0,
    cmdline: [],
    environ: null,
  },
  {
    pid: 777,
    ppid: 1049,
    pgid: 777,
    comm: "x) y (z",
    state: "T",
    nice: -5,
    ageS: 100,
    lifeCpuPct: 2,
    cmdline: ["./odd"],
  },
];

export const LOCKS = [
  `1: POSIX  ADVISORY  WRITE 349493 103:02:537238177 0 EOF`,
  `1: -> POSIX  ADVISORY  WRITE 2091490 103:02:537238177 0 EOF`,
  `2: POSIX  ADVISORY  READ 2091490 103:02:578571566 1073741826 1073742335`,
  `3: OFDLCK ADVISORY  WRITE -1 00:2c:1234 0 EOF`,
  `4: FLOCK  ADVISORY  WRITE 1200 00:2c:99 0 0`,
].join("\n");

export const SS_XLE = [
  "Netid State  Recv-Q Send-Q                                           Local Address:Port       Peer Address:PortProcess",
  "u_str LISTEN 0      511                           /run/user/1000/.201327086831dfaa 1057291937            * 0    <-> ino:325632 dev:0/44 peers:",
  "u_str LISTEN 0      511    /tmp/squeal-1000/tmp/1e2484abf6bcdf96/cez ci/ipc 205499193             * 0    <-> ino:1087533839 dev:0/66306 peers:",
  "u_str LISTEN 0      4096                                     @/tmp/.X11-unix/X0 31337            * 0",
  // Past 2^31 sockets, ss prints the socket inode as a signed 32-bit number (row 014-48).
  "u_str LISTEN 0      511          /tmp/squeal-1000/tmp/9a1c0e2b44d1f3a7/ipc -2068677298            * 0    <-> ino:74585546 dev:0/44 peers:",
  "",
].join("\n");

/** Snapshot 3's host files. */
export function writeHost(root: string): void {
  const proc = join(root, "proc");
  mkdirSync(join(proc, "pressure"), { recursive: true });
  mkdirSync(join(proc, "self", "ns"), { recursive: true });
  writeFileSync(join(proc, "loadavg"), "43.21 36.57 38.82 31/3218 2354001\n");
  writeFileSync(
    join(proc, "pressure", "cpu"),
    "some avg10=45.57 avg60=40.93 avg300=32.25 total=66243030799\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
  );
  writeFileSync(
    join(proc, "pressure", "memory"),
    "some avg10=0.64 avg60=0.45 avg300=0.72 total=1654188811\nfull avg10=0.52 avg60=0.21 avg300=0.38 total=1191497641\n",
  );
  writeFileSync(
    join(proc, "meminfo"),
    [
      "MemTotal:       49223972 kB",
      "MemFree:         1200000 kB",
      "MemAvailable:   16890700 kB",
      "SwapTotal:       4194300 kB",
      "SwapFree:            144 kB",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(proc, "stat"),
    [
      `cpu  9000000 500000 2000000 3000000 400000 0 100000 0 0 0`,
      `cpu0 375000 20833 83333 125000 16666 0 4166 0 0 0`,
      "intr 1 2 3",
      `btime ${BOOT_SECONDS}`,
      "processes 3200000",
      "",
    ].join("\n"),
  );
  writeFileSync(join(proc, "uptime"), `${UPTIME_SECONDS}.00 1.00\n`);
  writeFileSync(join(proc, "locks"), `${LOCKS}\n`);
  symlinkSync("pid:[4026531836]", join(proc, "self", "ns", "pid"));
}

/** The whole fixture tree under `root`. */
export function writeTree(root: string): void {
  writeHost(root);
  for (const p of PROCESSES) writeProcess(root, p);
  // A process that left after `readdir`: its directory is there, its files are not.
  mkdirSync(join(root, "proc", "4242"), { recursive: true });
  mkdirSync(join(root, "proc", "sys"), { recursive: true });
}
