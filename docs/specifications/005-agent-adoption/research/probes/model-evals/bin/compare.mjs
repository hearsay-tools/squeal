#!/usr/bin/env node
// Throwaway probe for 005-06. Reads logs/cells/*.grade.json and prints, per grouping key,
// the share of sessions showing each graded behaviour, and for each behaviour the repetitions
// per arm needed to tell two arms apart at the pilot's observed rates
// (two-sided alpha 0.05, power 0.8, normal approximation: n = 7.85 (p1 q1 + p2 q2) / (p1 - p2)^2).
//   node compare.mjs [variant|model|harness|task]...
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "logs", "cells");
const gs = readdirSync(DIR).filter((f) => f.endsWith(".grade.json")).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ["variant", "model"];

const B = {
  "own Vitest run": (g) => g.vitestRuns > 0,
  "own run after last edit": (g) => g.vitestAfterLastEdit > 0,
  "status --wait after last edit": (g) => g.waitsAfterLastEdit > 0,
  "sleep": (g) => g.sleeps > 0,
  "skill loaded": (g) => g.skillLoads > 0,
  "squeal why": (g) => g.squealWhy > 0,
  "run --slow": (g) => g.squealRunSlow > 0,
  "node:test run when scripts edited": (g) => (g.nodeTestWanted ? g.nodeTestRuns > 0 : null),
  "final claim true": (g) => (g.claimTrue === null ? null : g.claimTrue === true),
  "final claim false": (g) => (g.claimTrue === null ? null : g.claimTrue === false),
  "ended green (truth)": (g) => g.truth?.pass ?? null,
};

const group = (g) => keys.map((k) => g[k]).join(" / ");
const groups = [...new Set(gs.map(group))].sort();
const rate = (rows, f) => {
  const v = rows.map(f).filter((x) => x !== null);
  return v.length ? { k: v.filter(Boolean).length, n: v.length } : null;
};
console.log(`| Behaviour | ${groups.join(" | ")} |`);
console.log(`| --- | ${groups.map(() => "---").join(" | ")} |`);
for (const [name, f] of Object.entries(B)) {
  const cells = groups.map((gr) => rate(gs.filter((g) => group(g) === gr), f));
  console.log(`| ${name} | ${cells.map((c) => (c ? `${c.k}/${c.n}` : "-")).join(" | ")} |`);
}
const num = (name, f) => console.log(`| ${name} | ${groups.map((gr) => { const r = gs.filter((g) => group(g) === gr).map(f).filter((x) => x != null); return r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : "-"; }).join(" | ")} |`);
num("mean wall s", (g) => g.wallS);
num("mean status --wait calls", (g) => g.squealWaits);
num("mean Squeal pulls", (g) => g.squealPulls);
num("mean ms from first FAIL to next action", (g) => g.reactionToFirstFail?.ms ?? null);
num("mean cost $ (Claude Code), x1000", (g) => (g.cost == null ? null : g.cost * 1000));
num("mean output tokens (Codex)", (g) => (g.harness === "codex" ? g.usage?.output_tokens : null));

if (groups.length === 2) {
  console.log("\nRepetitions per arm to separate the two arms at these rates (alpha 0.05, power 0.8):");
  for (const [name, f] of Object.entries(B)) {
    const [a, b] = groups.map((gr) => rate(gs.filter((g) => group(g) === gr), f));
    if (!a || !b) continue;
    const p1 = a.k / a.n, p2 = b.k / b.n;
    const d = Math.abs(p1 - p2);
    console.log(`  ${name}: ${(p1 * 100).toFixed(0)}% vs ${(p2 * 100).toFixed(0)}% -> ${d === 0 ? "no difference observed" : Math.ceil((7.85 * (p1 * (1 - p1) + p2 * (1 - p2))) / d ** 2)}`);
  }
}
