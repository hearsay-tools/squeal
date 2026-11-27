#!/usr/bin/env node
// Runs the whole benchmark on this machine: machine facts and calibration,
// one installed template project per size, then every cell in order, then
// the scorecard. Meant for a fresh boat.dev sandbox (see boat-run.sh), but it
// runs on any Linux machine with Node >= 22.19, pnpm, git and sqlite3.
//
// Usage: node run-all.mjs --plugin <squeal claude-code plugin dir> --out <dir>
//          [--cells ref,size-s,...] [--steps 24] [--repeat N]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { installedVersions, timed } from "./lib.mjs";
import { calibrate, machineAfter, machineBefore, machineRecord, machineText } from "./machine.mjs";

export const CELLS = [
  { name: "ref", files: 500, worktrees: 1, load: 0 },
  { name: "size-s", files: 100, worktrees: 1, load: 0 },
  { name: "size-l", files: 2000, worktrees: 1, load: 0 },
  { name: "wt-3", files: 500, worktrees: 3, load: 0 },
  { name: "wt-6", files: 500, worktrees: 6, load: 0 },
  { name: "load-50", files: 500, worktrees: 1, load: 50 },
  { name: "load-100", files: 500, worktrees: 1, load: 100 },
  { name: "stress", files: 500, worktrees: 6, load: 100 },
  // Store age (age-store.mjs): the reference cell on a store with a week of history.
  // 70 rounds: Squeal's own week of results per test file, at 500 test files (about 1.7 GB).
  // 326 rounds: the loaded_modules row count of Squeal's own store, 7.2 GB on 2026-11-20.
  { name: "store-1.7g", files: 500, worktrees: 1, load: 0, ageRounds: 70 },
  { name: "store-7g", files: 500, worktrees: 1, load: 0, ageRounds: 326 },
  // Churn: the 7g store with history over 8 days, so about one day is past retention,
  // and the marks of the last prune and integrity check cleared: the restart checks
  // the whole file and the first prune deletes a day of history, as after a day away.
  { name: "churn", files: 500, worktrees: 1, load: 0, ageRounds: 326, spanDays: 8, churn: true },
  // The lists' share (feedback of 2026-11-20): an aged store with 3 active worktrees, where lock
  // time lands on the other worktrees, with and without module lists, and with one day of them.
  { name: "store-7g-wt3", files: 500, worktrees: 3, load: 0, ageRounds: 326 },
  {
    name: "store-7g-wt3-nolists",
    files: 500,
    worktrees: 3,
    load: 0,
    ageRounds: 326,
    lists: "none",
  },
  { name: "store-7g-lists1d", files: 500, worktrees: 1, load: 0, ageRounds: 326, lists: "1d" },
  // Issue 261: mid-session, the worktree brings in a commit that changes 125 of 500 modules.
  // ff: nobody ran that commit; ff-known: another worktree ran it first (as a base branch's CI
  // would), so the shared store holds its results; ff-load50: cold on a half-busy machine;
  // ff-rebase: the agent commits its own edits and rebases onto it.
  { name: "ff", files: 500, worktrees: 1, load: 0, ff: "cold" },
  { name: "ff-known", files: 500, worktrees: 1, load: 0, ff: "known" },
  // ff-ci: the incoming commit's results come from CI through spec 018 (ci record, ci export,
  // squeal import), not from a sibling worktree.
  { name: "ff-ci", files: 500, worktrees: 1, load: 0, ff: "ci" },
  { name: "ff-load50", files: 500, worktrees: 1, load: 50, ff: "cold" },
  { name: "ff-rebase", files: 500, worktrees: 1, load: 0, ff: "cold", ffMode: "rebase" },
  // Row 025-08: a real repository's scale for `status` reads: 2,000 test files of 10 cases
  // (20,000 checks) and 30 helper functions per module (about 62,000 functions). Opt-in: not in
  // @all, only by name or @scale (OPT_IN below); its full run alone is about 300 CPU-seconds.
  { name: "scale-real", files: 2000, worktrees: 1, load: 0, cases: 10, functions: 30 },
];
/** Cells a plain run and `@all` leave out; name them or their group. */
export const OPT_IN = new Set(["scale-real"]);

/** The template a cell runs on: one per project shape (files, cases per file, helper functions). */
export function templateKey(c) {
  const cases = c.cases ?? 6;
  const functions = c.functions ?? 0;
  return cases === 6 && functions === 0 ? `p${c.files}` : `p${c.files}-c${cases}-f${functions}`;
}

/**
 * Named groups for `--cells`: `@<group>` stands for its cells, and groups and
 * cells mix (`--cells @worktrees,churn`). An axis group varies one factor from
 * `ref`; an area group holds the cells a kind of change is most likely to move,
 * for a first, cheaper check before the full run (README, "Subsets first").
 */
export const GROUPS = {
  // Axes: one factor at a time, with ref as the fixed point.
  size: ["size-s", "ref", "size-l"],
  worktrees: ["ref", "wt-3", "wt-6"],
  load: ["ref", "load-50", "load-100"],
  store: ["ref", "store-1.7g", "store-7g", "churn"],
  lists: ["store-7g", "store-7g-wt3", "store-7g-wt3-nolists", "store-7g-lists1d"],
  ff: ["ff", "ff-known", "ff-ci", "ff-load50", "ff-rebase"],
  // Areas: where a change of that kind shows first.
  quick: ["ref", "wt-3"],
  hooks: ["ref", "wt-3", "stress"],
  contention: ["wt-3", "wt-6", "stress", "store-7g-wt3"],
  scheduler: ["ref", "wt-3", "load-50", "size-l"],
  // Real repository scale (opt-in): size-l's file count, 10 cases and 30 functions per file.
  scale: ["size-l", "scale-real"],
  all: [],
};
GROUPS.all = CELLS.filter((c) => !OPT_IN.has(c.name)).map((c) => c.name);
export function selectCells(spec) {
  if (!spec) return CELLS.filter((c) => !OPT_IN.has(c.name));
  const names = new Set();
  for (const part of spec.split(",")) {
    const group = part.startsWith("@") ? GROUPS[part.slice(1)] : null;
    if (part.startsWith("@") && !group)
      throw new Error(`no cell group ${part}; groups: ${Object.keys(GROUPS).join(", ")}`);
    for (const n of group ?? [part]) {
      if (!CELLS.some((c) => c.name === n)) throw new Error(`no cell ${n}`);
      names.add(n);
    }
  }
  return CELLS.filter((c) => names.has(c.name));
}
/** Runs per cell and version when --repeat is not given: 3 for a paired run (row 025-27), else 1. */
export function defaultRepeat(versions) {
  return versions > 1 ? 3 : 1;
}

/** Adds the machine speed around the cell to its cell.json (row 025-27); returns the record. */
export function recordMachine(cellDir, before, after) {
  const machine = machineRecord(before, after);
  const file = join(cellDir, "cell.json");
  if (existsSync(file)) {
    const cell = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify({ ...cell, machine }, null, 2)}\n`);
  }
  return machine;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

/** The whole run: machine facts, templates, every chosen cell, the scorecard. */
async function main() {
  const { values: o } = parseArgs({
    options: {
      // Repeat --plugin to compare versions on one machine: every cell runs once per
      // plugin, in alternating order (A B, then B A), so they share the CPU and its drift.
      plugin: { type: "string", multiple: true },
      out: { type: "string" },
      cells: { type: "string" },
      steps: { type: "string", default: "24" },
      // Run each cell (and each version of it) this many times, to see run-to-run noise.
      // Default 3 for a paired run, so the comparison can tell a change from the spread; 1 otherwise.
      repeat: { type: "string" },
    },
  });
  const HERE = import.meta.dirname;
  const out = o.out;
  mkdirSync(out, { recursive: true });
  const chosen = selectCells(o.cells);
  const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

  const plugins = o.plugin.map((dir) => {
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    return { dir, version, label: version };
  });
  for (const [i, p] of plugins.entries()) {
    if (plugins.some((q, j) => j !== i && q.version === p.version))
      p.label = `${p.version}-${i + 1}`;
  }
  const paired = plugins.length > 1;
  // One run per cell and plugin. A paired run's name is `<cell>@<label>`.
  const repeat = o.repeat === undefined ? defaultRepeat(plugins.length) : Number(o.repeat);
  // Names: `<cell>`, `<cell>@<version>` when paired, `-r<n>` added when repeated. Never `#`:
  // the name is a folder in the project's path, and Vite cuts a path at `#` (2026-11-20: every test failed to load).
  const cells = chosen.flatMap((c, i) =>
    Array.from({ length: repeat }, (_, k) => {
      const order = (i + k) % 2 === 0 ? plugins : [...plugins].reverse();
      return order.map((p) => ({
        ...c,
        name: `${c.name}${paired ? `@${p.label}` : ""}${repeat > 1 ? `-r${k + 1}` : ""}`,
        base: c.name,
        plugin: p.label,
        rep: k + 1,
      }));
    }).flat(),
  );
  // Machine facts and a single-thread calibration (SHA-256 over 1 MiB for 3 s), three times.
  const meta = {
    startedAt: new Date().toISOString(),
    squealVersion: plugins.map((p) => p.version).join(" vs "),
    plugins: plugins.map(({ version, label }) => ({ version, label })),
    repeat,
    node: process.version,
    cpuModel: cpus()[0]?.model,
    vcpus: cpus().length,
    memGiB: +(totalmem() / 2 ** 30).toFixed(1),
    freeMemGiB: +(freemem() / 2 ** 30).toFixed(1),
    sha256MiBPerS: [calibrate(), calibrate(), calibrate()],
    loadavgAtStart: readFileSync("/proc/loadavg", "utf8").trim(),
    cells,
  };
  log(
    `machine ${meta.cpuModel} x${meta.vcpus}, sha256 ${meta.sha256MiBPerS.map((x) => x.toFixed(0)).join("/")} MiB/s`,
  );
  writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

  // Templates: one generated, committed, installed project per shape (templateKey).
  const templates = new Map();
  for (const c of cells) {
    const key = templateKey(c);
    if (templates.has(key)) continue;
    const dir = join(`${out}-templates`, key);
    if (!existsSync(join(dir, "node_modules"))) {
      log(`template ${key}`);
      await timed(process.execPath, [
        join(HERE, "gen-project.mjs"),
        dir,
        String(c.files),
        "--cases",
        String(c.cases ?? 6),
        "--functions",
        String(c.functions ?? 0),
      ]);
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: "bench",
        GIT_AUTHOR_EMAIL: "bench@example.invalid",
        GIT_COMMITTER_NAME: "bench",
        GIT_COMMITTER_EMAIL: "bench@example.invalid",
      };
      const inst = await timed("pnpm", ["install", "--silent"], { cwd: dir, timeoutMs: 600_000 });
      if (inst.code !== 0) throw new Error(`pnpm install failed: ${inst.stderr}`);
      for (const args of [
        ["init", "-q", "-b", "main"],
        ["add", "-A"],
        ["commit", "-qm", "bench project"],
      ]) {
        await timed("git", args, { cwd: dir, env: gitEnv });
      }
    }
    templates.set(key, dir);
  }
  // What each template installed (BENCH_DEPS pins them; this records that the pin held).
  meta.deps = Object.fromEntries([...templates].map(([key, dir]) => [key, installedVersions(dir)]));
  writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

  for (const c of cells) {
    log(`cell ${c.name}: ${c.files} files, ${c.worktrees} worktrees, ${c.load}% load`);
    const before = machineBefore();
    const r = await timed(
      process.execPath,
      [
        join(HERE, "run-cell.mjs"),
        "--name",
        c.name,
        "--template",
        templates.get(templateKey(c)),
        "--files",
        String(c.files),
        "--worktrees",
        String(c.worktrees),
        "--load",
        String(c.load),
        "--plugin",
        plugins.find((p) => p.label === c.plugin).dir,
        "--out",
        join(out, "cells", c.name),
        "--steps",
        o.steps,
        "--age-rounds",
        String(c.ageRounds ?? 0),
        "--age-span-days",
        String(c.spanDays ?? 7),
        "--age-lists",
        c.lists ?? "7d",
        "--ff",
        c.ff ?? "none",
        "--ff-mode",
        c.ffMode ?? "merge",
        ...(c.churn ? ["--churn"] : []),
      ],
      { timeoutMs: 7_200_000 },
    );
    writeFileSync(join(out, `cell-${c.name}.log`), r.stdout + r.stderr);
    const machine = recordMachine(join(out, "cells", c.name), before, machineAfter());
    log(
      `cell ${c.name} exit ${r.code} in ${(r.ms / 60000).toFixed(1)} min, ${machineText(machine)}`,
    );
  }

  meta.endedAt = new Date().toISOString();
  writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  const s = await timed(process.execPath, [join(HERE, "summarize.mjs"), out]);
  writeFileSync(join(out, "scorecard.md"), s.stdout);
  console.log(s.stdout + s.stderr);
}
