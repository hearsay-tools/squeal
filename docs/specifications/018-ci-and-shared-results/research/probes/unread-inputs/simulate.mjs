// Throwaway probe (row 018-56). Applies candidate rule D (one rule for C and D) to what
// `ci export` left out in one fixture run of fixture.sh: an input no hooked process read,
// listed or wrote is certified when its blob id at the command's start, at its end and in the
// export checkout are equal (null: absent at all three). Reads the raw evidence lines
// (`{e: {path: hash}, w: [path], t: [path]}`, src/runners/ci-runtime/evidence.cjs).
// Usage: node simulate.mjs <mode-out dir> <checkout>
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [out, checkout] = process.argv.slice(2);
const evidenceDir = join(out, "evidence");
const read = new Map();
const written = new Set();
const trees = new Set();
for (const name of existsSync(evidenceDir) ? readdirSync(evidenceDir) : [])
  for (const text of readFileSync(join(evidenceDir, name), "utf8").split("\n")) {
    if (!text) continue;
    let line;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    for (const [p, v] of Object.entries(line.e ?? {})) read.set(p, [...(read.get(p) ?? []), v]);
    for (const p of line.w ?? []) written.add(p);
    for (const p of line.t ?? []) trees.add(p);
  }
const table = (file) =>
  new Map(
    readFileSync(join(out, file), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(41), l.slice(0, 40)]),
  );
const start = table("start.txt");
const end = table("end.txt");
const here = (p) =>
  existsSync(join(checkout, p)) ? execFileSync("git", ["hash-object", p], { cwd: checkout }).toString().trim() : null;
const below = (p) => [...trees].some((t) => t === "" || p === t || p.startsWith(`${t}/`));

const uncertifiedFile = join(out, "uncertified.json");
const files = existsSync(uncertifiedFile) ? JSON.parse(readFileSync(uncertifiedFile, "utf8")) : [];
if (files.length === 0) console.log("today: no file left out for inputs");
for (const { testFile, inputs } of files) {
  const why = inputs.map((p) => {
    if (read.has(p)) return `${p}: read by a hooked process (${[...new Set(read.get(p))].map((v) => (v ?? "absent").slice(0, 8)).join(", ")}), rule does not apply`;
    if (written.has(p) || below(p)) return `${p}: written by a hooked process, rule does not apply`;
    const s = start.get(p) ?? null;
    const e = end.get(p) ?? null;
    const h = here(p);
    const ok = s === e && e === h;
    return `${p}: unread; start ${s?.slice(0, 8) ?? "absent"}, end ${e?.slice(0, 8) ?? "absent"}, here ${h?.slice(0, 8) ?? "absent"}: ${ok ? "CERTIFIED" : "not certified"}`;
  });
  const all = why.every((w) => w.endsWith("CERTIFIED"));
  console.log(`today: left out ${testFile.path}; rule: ${all ? "EXPORTS it" : "leaves it out"}`);
  for (const w of why) console.log(`  ${w}`);
}
