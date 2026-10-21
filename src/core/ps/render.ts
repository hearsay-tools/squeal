import type { Render } from "./model.js";
import type {
  PsDaemon,
  PsFileFlag,
  PsFlag,
  PsHost,
  PsOrphan,
  PsRepository,
  PsSnapshot,
  PsSqueal,
  PsTestProcess,
} from "./shape.js";

/*
 * Spec 014 D8 (task 014-11): the text of `squeal ps`, from the shape alone.
 * The first line is the answer; then the host, Squeal, one block per
 * repository, the processes no daemon owns and the files no process uses.
 * A flagged row starts with `!`, with its reason and the command that would
 * end it under it. A value `ps` could not read prints as `?` in a column and
 * as `unknown` in a sentence, never as 0.
 */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const UNKNOWN = "?";
/** A state wider than its column takes a line of its own above its row. */
const STATE_WIDTH = 19;
const DETAIL = "      ";

export const render: Render = (snapshot, { full }) => {
  const lines = [firstLine(snapshot), hostLine(snapshot.host), squealLine(snapshot)];
  if (snapshot.repositories.length === 0) lines.push("", "No Squeal daemon runs.");
  for (const repository of snapshot.repositories)
    lines.push("", ...repositoryBlock(repository, snapshot, full));
  if (snapshot.orphans.length > 0) {
    lines.push("", "Processes no live daemon owns");
    for (const orphan of snapshot.orphans) lines.push(...orphanLines(orphan, snapshot.at));
  }
  if (snapshot.files.length > 0) {
    lines.push("", "Files no live process uses");
    for (const file of snapshot.files) lines.push(...fileLines(file));
  }
  if (snapshot.unflaggedFiles !== null) {
    const counts = snapshot.unflaggedFiles.map((f) => `${f.kind} ${thousands(f.count)}`);
    lines.push(
      "",
      `Files that never get a flag: ${counts.length === 0 ? "none" : counts.join(", ")}`,
    );
  }
  if (snapshot.unknown.length > 0 && !full)
    lines.push("", `Unknown: ${count(snapshot.unknown.length, "value")}; --full names each`);
  if (snapshot.unknown.length > 0 && full) {
    lines.push("", "Unknown");
    for (const u of snapshot.unknown) lines.push(`  ${u.what}: ${u.why}`);
  }
  return `${lines.join("\n")}\n`;
};

function firstLine(s: PsSnapshot): string {
  const names = new Map<string, number>();
  const daemons = s.repositories.flatMap((r) => r.daemons);
  const all = [
    ...daemons.flatMap((d) => [...d.flags, ...d.processes.flatMap((p) => p.flags)]),
    ...s.orphans.flatMap((o) => o.flags),
    ...s.files,
  ];
  for (const f of all) names.set(f.flag, (names.get(f.flag) ?? 0) + 1);
  const listed = [...names].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`)).join(", ");
  const flags = s.flags === 0 ? "no flags" : `${count(s.flags, "flag")}: ${listed}`;
  const processes = count(s.squeal.testProcesses, "test process", "test processes");
  return `squeal ps · ${count(s.squeal.daemons, "daemon")}, ${processes} · ${flags}`;
}

function hostLine(h: PsHost): string {
  const load =
    h.load === null ? "load unknown" : `load ${h.load.map((l) => l.toFixed(1)).join(" ")}`;
  const pressure =
    h.memoryPressure === null
      ? "memory pressure unknown"
      : `memory pressure ${pct(h.memoryPressure.some)} (${pct(h.memoryPressure.full)} full)`;
  const used = h.memTotal === null || h.memAvailable === null ? null : h.memTotal - h.memAvailable;
  const swap =
    h.swapUsed === null || h.swapTotal === null
      ? "swap unknown"
      : `swap ${ofGib(h.swapUsed, h.swapTotal)}`;
  return [
    `Host    ${load} on ${count(h.cpus, "CPU")}`,
    `CPU pressure ${h.cpuPressure === null ? "unknown" : pct(h.cpuPressure)}`,
    pressure,
    `${used === null || h.memTotal === null ? "memory unknown" : `memory ${ofGib(used, h.memTotal)} used`}, ${swap}`,
  ].join(" · ");
}

function squealLine(s: PsSnapshot): string {
  const q: PsSqueal = s.squeal;
  const share = q.cpuShare === null ? "share of busy unknown" : `${pct(q.cpuShare)} of busy`;
  const cpu = q.cpuPct === null ? "CPU unknown" : `CPU ${cpus(q.cpuPct)} CPUs (${share})`;
  const used = q.memoryShare === null ? "share of used unknown" : `${pct(q.memoryShare)} of used`;
  const kind = s.memory === "rss" ? "RSS" : "memory";
  const rss = s.memory === "rss" ? ", shared pages counted more than once" : "";
  const memory = `${kind} ${size(q.privateBytes)} (${used})${rss}`;
  const swap = q.swapBytes === null ? "swap unknown" : `${size(q.swapBytes)} swap`;
  const pool =
    q.pool.held === null
      ? `pool ${q.pool.slots} permits, held unknown`
      : `pool ${q.pool.held} of ${count(q.pool.slots, "permit")}`;
  return `Squeal  ${cpu} · ${memory} + ${swap} · ${pool}`;
}

function repositoryBlock(r: PsRepository, s: PsSnapshot, full: boolean): string[] {
  const name = r.commonDir === null ? "repository unknown" : r.commonDir.replace(/\/\.git$/, "");
  const all = r.daemons.flatMap((d) => [
    d,
    ...d.processes,
    ...d.processes.map((p) => p.descendants),
  ]);
  const cpu = known(all.map((x) => x.cpuPct));
  const memory = known(all.map((x) => x.privateBytes));
  const lines = [
    [
      `${name}${r.current ? " (this repository)" : ""}`,
      count(r.daemons.length, "daemon"),
      `CPU ${cpu === null ? "unknown" : cpus(cpu)}`,
      `${s.memory === "rss" ? "RSS" : "memory"} ${size(memory)}`,
    ].join(" · "),
    row("  ", {
      state: "STATE",
      pid: "PID",
      worktree: "WORKTREE",
      version: "VERSION",
      up: "UP",
      cpu: "CPU",
      time: "CPU TIME",
      memory: s.memory === "rss" ? "RSS" : "MEMORY",
      swap: "SWAP",
      work: "WORK",
    }),
  ];
  for (const d of r.daemons) {
    lines.push(...daemonLines(d, s.at));
    for (const p of d.processes) lines.push(...processLines(p, s.at, full));
  }
  return lines;
}

function daemonLines(d: PsDaemon, at: number): string[] {
  const margin = d.flags.length > 0 ? "! " : "  ";
  const own = d.state.length < STATE_WIDTH;
  const version = [d.version ?? UNKNOWN, d.harness].filter((v) => v !== null).join(" ");
  return [
    ...(own ? [] : [`${margin}${d.state}`]),
    row(own ? margin : "  ", {
      state: own ? d.state : "",
      pid: String(d.pid),
      worktree: d.worktreeId?.slice(0, 8) ?? UNKNOWN,
      version,
      up: age(d.startedAt, at),
      cpu: percent(d.cpuPct),
      time: cpuTime(d.cpuMs),
      memory: size(d.privateBytes, true),
      swap: size(d.swapBytes, true),
      work: workOf(d, at),
    }),
    ...flagLines(d.flags),
  ];
}

function processLines(p: PsTestProcess, at: number, full: boolean): string[] {
  const own = [p.cpuPct, p.descendants.cpuPct];
  const children =
    p.descendants.count === 0 ? [] : [`+${count(p.descendants.count, "child", "children")}`];
  const lines = [
    row(p.flags.length > 0 ? "! " : "  ", {
      state: `  ${p.lane ?? p.runner ?? "test"}`,
      pid: String(p.pid),
      detail: detailOf(p),
      up: age(p.startedAt, at),
      cpu: percent(known(own)),
      time: cpuTime(known([p.cpuMs, p.descendants.cpuMs])),
      memory: size(known([p.privateBytes, p.descendants.privateBytes]), true),
      swap: size(known([p.swapBytes, p.descendants.swapBytes]), true),
      work: [...(p.escaped ? ["escaped"] : []), `nice ${p.nice}`, ...children].join(", "),
    }),
    ...flagLines(p.flags),
  ];
  if (!full) return lines;
  for (const c of p.descendants.list ?? [])
    lines.push(
      row("  ", {
        state: `    ${c.comm}`,
        pid: String(c.pid),
        detail: "",
        up: "",
        cpu: percent(c.cpuPct),
        time: cpuTime(c.cpuMs),
        memory: size(c.privateBytes, true),
        swap: size(c.swapBytes, true),
        work: "",
      }),
    );
  return lines;
}

function orphanLines(o: PsOrphan, at: number): string[] {
  return o.flags.flatMap((f) => [
    `  ! ${f.flag}  pid ${o.pid} ${o.comm}, up ${age(o.startedAt, at)} (${f.reason})`,
    `${DETAIL}ends it: ${f.command ?? "none"}`,
  ]);
}

function fileLines(f: PsFileFlag): string[] {
  // Only `leftover-temp` groups its paths, which are directories (D7).
  const what =
    f.path ??
    `${thousands(f.count)} ${f.count === 1 ? "directory" : "directories"}, ${f.bytes === null ? "size unknown" : size(f.bytes)}`;
  return [`  ! ${f.flag}  ${what} (${f.reason})`, `${DETAIL}ends it: ${f.command}`];
}

function flagLines(flags: readonly PsFlag[]): string[] {
  return flags.flatMap((f) => [
    `${DETAIL}${f.flag}: ${f.reason}`,
    `${DETAIL}ends it: ${f.command ?? "none"}`,
  ]);
}

/** A daemon's WORK column: its open tiers, checkpoints and backlog, its departure and its sessions. */
function workOf(d: PsDaemon, at: number): string {
  if (d.phase === "waiting") return "waits for its lock";
  const w = d.work;
  const parts = w.tiers.map(
    (t) => `${t.lane === null ? "" : `${t.lane} `}tier, ${count(t.files, "file")}`,
  );
  if (w.tiers.length === 0)
    for (const c of w.checkpoints) parts.push(`checkpoint, ${count(c.files, "file")}`);
  if (w.pending === null) parts.push("work unknown");
  else if (w.pending > 0) parts.push(`${w.pending} pending`);
  if (d.consumers.length > 0) parts.push(count(d.consumers.length, "session"));
  if (w.departedAt !== null) parts.push(`session left ${age(w.departedAt, at)} ago`);
  return parts.length === 0 ? "idle" : parts.join("; ");
}

function detailOf(p: PsTestProcess): string {
  if (p.runner === "vitest" && p.files === null) return "fork worker";
  if (p.files === null) return p.runner ?? "";
  const [only] = p.files;
  return p.files.length === 1 && only !== undefined
    ? only
    : `${p.runner ?? "test"}, ${count(p.files.length, "file")}`;
}

interface Row {
  readonly state: string;
  readonly pid: string;
  readonly worktree?: string;
  readonly version?: string;
  /** A test process's runner and files, over the worktree and version columns. */
  readonly detail?: string;
  readonly up: string;
  readonly cpu: string;
  readonly time: string;
  readonly memory: string;
  readonly swap: string;
  readonly work: string;
}

function row(margin: string, r: Row): string {
  const left =
    r.detail === undefined
      ? (r.worktree ?? "").padEnd(10) + (r.version ?? "").padEnd(15)
      : clip(r.detail, 24).padEnd(25);
  const line =
    margin +
    r.state.padEnd(STATE_WIDTH) +
    r.pid.padEnd(9) +
    left +
    r.up.padStart(4) +
    r.cpu.padStart(6) +
    r.time.padStart(10) +
    "  " +
    r.memory.padEnd(8) +
    r.swap.padEnd(6) +
    r.work;
  return line.trimEnd();
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : `…${text.slice(text.length - width + 1)}`;
}

/** Sums the values that are known; `null` when none is. */
function known(values: readonly (number | null)[]): number | null {
  const read = values.filter((v): v is number => v !== null);
  return read.length === 0 ? null : read.reduce((a, b) => a + b, 0);
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${thousands(n)} ${n === 1 ? one : many}`;
}

function thousands(n: number): string {
  return n.toLocaleString("en-US");
}

/** A percent in a sentence: whole above 10, one decimal below. */
function pct(value: number): string {
  return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

function percent(value: number | null): string {
  return value === null ? UNKNOWN : `${Math.round(value)}%`;
}

/** Percent of one CPU as CPUs, one decimal. */
function cpus(value: number): string {
  return (value / 100).toFixed(1);
}

/** Bytes: `2.2G`, `310M`, `512K` in a column; `2.2 GiB`, `310 MiB` in a sentence. */
function size(bytes: number | null, column = false): string {
  if (bytes === null) return column ? UNKNOWN : "unknown";
  if (bytes === 0) return "0";
  const [value, unit] =
    bytes >= GIB
      ? [(bytes / GIB).toFixed(1), "G"]
      : bytes >= MIB
        ? [String(Math.round(bytes / MIB)), "M"]
        : [String(Math.round(bytes / KIB)), "K"];
  return column ? `${value}${unit}` : `${value} ${unit}iB`;
}

function ofGib(part: number, whole: number): string {
  return `${(part / GIB).toFixed(1)} of ${(whole / GIB).toFixed(1)} GiB`;
}

/** The time from `since` to `at`: `45s`, `39m`, `5h`, `3d`. */
function age(since: number | null, at: number): string {
  if (since === null) return UNKNOWN;
  const s = Math.max(0, Math.floor((at - since) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 100 * 60) return `${Math.floor(s / 60)}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** Cumulative CPU time: `11m42s`, `2h05m`. */
function cpuTime(ms: number | null): string {
  if (ms === null) return UNKNOWN;
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  if (s < 3600) return `${Math.floor(s / 60)}m${two(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${two(Math.floor(s / 60) % 60)}m`;
}
