import type { Render } from "./model.js";
import {
  age,
  bytes,
  count,
  cpus,
  cpuTime,
  ofGib,
  percent,
  share,
  thousands,
  UNKNOWN,
} from "./render-units.js";
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
 * as `unknown` in a sentence, never as 0. A sum that leaves an unknown value
 * out is a lower bound: `at least` in a sentence, a `+` after it in a column
 * (014-24).
 */

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
      : `memory pressure ${share(h.memoryPressure.some)} (${share(h.memoryPressure.full)} full)`;
  const used = h.memTotal === null || h.memAvailable === null ? null : h.memTotal - h.memAvailable;
  const swap =
    h.swapUsed === null || h.swapTotal === null
      ? "swap unknown"
      : `swap ${ofGib(h.swapUsed, h.swapTotal)}`;
  return [
    `Host    ${load} on ${count(h.cpus, "CPU")}`,
    `CPU pressure ${h.cpuPressure === null ? "unknown" : share(h.cpuPressure)}`,
    pressure,
    `${used === null || h.memTotal === null ? "memory unknown" : `memory ${ofGib(used, h.memTotal)} used`}, ${swap}`,
  ].join(" · ");
}

function squealLine(s: PsSnapshot): string {
  const q: PsSqueal = s.squeal;
  const out = q.skipped;
  const ofBusy = lower(q.cpuShare, out.cpuPct, (v) => `${share(v)} of busy`);
  const cpu = lower(q.cpuPct, out.cpuPct, (v) => `${cpus(v)} CPUs`);
  const used = lower(q.memoryShare, out.privateBytes, (v) => `${share(v)} of used`);
  const kind = s.memory === "rss" ? "RSS" : "memory";
  const rss = s.memory === "rss" ? ", shared pages counted more than once" : "";
  const amount = lower(q.privateBytes, out.privateBytes, (v) => bytes(v)) ?? "unknown";
  const memory = `${kind} ${amount} (${used ?? "share of used unknown"})${rss}`;
  const swap = lower(q.swapBytes, out.swapBytes, (v) => `${bytes(v)} swap`) ?? "swap unknown";
  const pool =
    q.pool.held === null
      ? `pool ${q.pool.slots} permits, held unknown`
      : `pool ${q.pool.held} of ${count(q.pool.slots, "permit")}`;
  const busy = ofBusy ?? "share of busy unknown";
  return `Squeal  ${cpu === null ? "CPU unknown" : `CPU ${cpu} (${busy})`} · ${memory} + ${swap} · ${pool}`;
}

function repositoryBlock(r: PsRepository, s: PsSnapshot, full: boolean): string[] {
  const name = r.commonDir === null ? "repository unknown" : r.commonDir.replace(/\/\.git$/, "");
  const cpu = lower(r.cpuPct, r.skipped.cpuPct, cpus) ?? "unknown";
  const memory = lower(r.privateBytes, r.skipped.privateBytes, (v) => bytes(v)) ?? "unknown";
  const lines = [
    [
      `${name}${r.current ? " (this repository)" : ""}`,
      count(r.daemons.length, "daemon"),
      `CPU ${cpu}`,
      `${s.memory === "rss" ? "RSS" : "memory"} ${memory}`,
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
      memory: bytes(d.privateBytes, true),
      swap: bytes(d.swapBytes, true),
      work: workOf(d, at),
    }),
    ...flagLines(d.flags),
  ];
}

function processLines(p: PsTestProcess, at: number, full: boolean): string[] {
  const d = p.descendants;
  // Its own value without descendants; with them, unknown when either part is (`reviews/wave-2.md` B3).
  const and = (own: number | null, sum: number | null): number | null =>
    d.count === 0 ? own : own === null || sum === null ? null : own + sum;
  // A lower bound when the descendants' sum leaves an unknown value out (014-24).
  const plus = (text: string, out: number): string =>
    out > 0 && text !== UNKNOWN ? `${text}+` : text;
  const children = d.count === 0 ? [] : [`+${count(d.count, "child", "children")}`];
  const lines = [
    row(p.flags.length > 0 ? "! " : "  ", {
      state: `  ${p.lane ?? p.runner ?? "test"}`,
      pid: String(p.pid),
      detail: detailOf(p),
      up: age(p.startedAt, at),
      cpu: plus(percent(and(p.cpuPct, d.cpuPct)), d.skipped.cpuPct),
      time: cpuTime(and(p.cpuMs, d.cpuMs)),
      memory: plus(bytes(and(p.privateBytes, d.privateBytes), true), d.skipped.privateBytes),
      swap: plus(bytes(and(p.swapBytes, d.swapBytes), true), d.skipped.swapBytes),
      work: [...(p.escaped ? ["escaped"] : []), `nice ${p.nice}`, ...children].join(", "),
    }),
    ...flagLines(p.flags),
  ];
  if (!full) return lines;
  for (const c of d.list ?? [])
    lines.push(
      row("  ", {
        state: `    ${c.comm}`,
        pid: String(c.pid),
        detail: "",
        up: "",
        cpu: percent(c.cpuPct),
        time: cpuTime(c.cpuMs),
        memory: bytes(c.privateBytes, true),
        swap: bytes(c.swapBytes, true),
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
    `${thousands(f.count)} ${f.count === 1 ? "directory" : "directories"}, ${f.bytes === null ? "size unknown" : bytes(f.bytes)}`;
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

/** `value` as `text` gives it, after `at least` when its sum left `out` unknown values out; `null` when unknown. */
function lower(value: number | null, out: number, text: (v: number) => string): string | null {
  return value === null ? null : `${out > 0 ? "at least " : ""}${text(value)}`;
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
