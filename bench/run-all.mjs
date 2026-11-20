#!/usr/bin/env node
// Runs the whole benchmark on this machine: machine facts and calibration,
// one installed template project per size, then every cell in order, then
// the scorecard. Meant for a fresh boat.dev sandbox (see boat-run.sh), but it
// runs on any Linux machine with Node >= 22.19, pnpm, git and sqlite3.
//
// Usage: node run-all.mjs --plugin <squeal claude-code plugin dir> --out <dir>
//          [--cells ref,size-s,...] [--steps 24]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { timed } from "./lib.mjs";

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
];

const { values: o } = parseArgs({
  options: {
    // Repeat --plugin to compare versions on one machine: every cell runs once per
    // plugin, in alternating order (A B, then B A), so they share the CPU and its drift.
    plugin: { type: "string", multiple: true },
    out: { type: "string" },
    cells: { type: "string" },
    steps: { type: "string", default: "24" },
    // Run each cell (and each version of it) this many times, to see run-to-run noise.
    repeat: { type: "string", default: "1" },
  },
});
const HERE = import.meta.dirname;
const out = o.out;
mkdirSync(out, { recursive: true });
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
  // Areas: where a change of that kind shows first.
  quick: ["ref", "wt-3"],
  hooks: ["ref", "wt-3", "stress"],
  contention: ["wt-3", "wt-6", "stress", "store-7g-wt3"],
  scheduler: ["ref", "wt-3", "load-50", "size-l"],
  all: [],
};
GROUPS.all = CELLS.map((c) => c.name);
function selectCells(spec) {
  if (!spec) return CELLS;
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
const chosen = selectCells(o.cells);
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// Machine facts and a single-thread calibration: SHA-256 over 1 MiB for 3 s.
function calibrate() {
  const buf = Buffer.alloc(1 << 20, 7);
  const end = performance.now() + 3000;
  let n = 0;
  while (performance.now() < end) {
    createHash("sha256").update(buf).digest();
    n++;
  }
  return n / 3;
}
const plugins = o.plugin.map((dir) => {
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  return { dir, version, label: version };
});
for (const [i, p] of plugins.entries()) {
  if (plugins.some((q, j) => j !== i && q.version === p.version)) p.label = `${p.version}-${i + 1}`;
}
const paired = plugins.length > 1;
// One run per cell and plugin. A paired run's name is `<cell>@<label>`.
const repeat = Number(o.repeat);
// Names: `<cell>`, `<cell>@<version>` when paired, `#<n>` added when repeated.
const cells = chosen.flatMap((c, i) =>
  Array.from({ length: repeat }, (_, k) => {
    const order = (i + k) % 2 === 0 ? plugins : [...plugins].reverse();
    return order.map((p) => ({
      ...c,
      name: `${c.name}${paired ? `@${p.label}` : ""}${repeat > 1 ? `#${k + 1}` : ""}`,
      base: c.name,
      plugin: p.label,
      rep: k + 1,
    }));
  }).flat(),
);
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

// Templates: one generated, committed, installed project per size.
const templates = new Map();
for (const files of [...new Set(cells.map((c) => c.files))]) {
  const dir = join(`${out}-templates`, `p${files}`);
  if (!existsSync(join(dir, "node_modules"))) {
    log(`template ${files} files`);
    await timed(process.execPath, [join(HERE, "gen-project.mjs"), dir, String(files)]);
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
  templates.set(files, dir);
}

for (const c of cells) {
  log(`cell ${c.name}: ${c.files} files, ${c.worktrees} worktrees, ${c.load}% load`);
  const r = await timed(
    process.execPath,
    [
      join(HERE, "run-cell.mjs"),
      "--name",
      c.name,
      "--template",
      templates.get(c.files),
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
      ...(c.churn ? ["--churn"] : []),
    ],
    { timeoutMs: 7_200_000 },
  );
  writeFileSync(join(out, `cell-${c.name}.log`), r.stdout + r.stderr);
  log(`cell ${c.name} exit ${r.code} in ${(r.ms / 60000).toFixed(1)} min`);
}

meta.endedAt = new Date().toISOString();
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
const s = await timed(process.execPath, [join(HERE, "summarize.mjs"), out]);
writeFileSync(join(out, "scorecard.md"), s.stdout);
console.log(s.stdout + s.stderr);
