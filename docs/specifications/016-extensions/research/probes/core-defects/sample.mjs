// Throwaway probe for 016-11: pick 10% of the deduplicated E items with a fixed seed, and print
// them with a longer excerpt and no codes, for the blind re-read. Usage:
// node sample.mjs <items.jsonl> <classes.tsv> > sample.txt
import { readFileSync } from "node:fs";

const [itemsPath, classesPath] = process.argv.slice(2);
const items = readFileSync(itemsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cls = new Map(readFileSync(classesPath, "utf8").trim().split("\n").map((l) => { const [id, p] = l.split("\t"); return [id, p]; }));
const RESIDUAL = /residual|still|remains|remaining|prior|again|partially|unchanged|reproduction fixed/i;
const e = items.filter((i) => cls.get(i.id) === "E" && !(i.src === "review" && RESIDUAL.test(i.title) && i.id !== "R213"));
// mulberry32, seed 16011 (the brief's number).
let s = 16011;
const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const order = e.map((i) => [rand(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
const n = Math.round(e.length / 10);
console.error(`E deduplicated: ${e.length}, sample ${n}`);
for (const i of order.slice(0, n)) console.log(`${i.id} [${i.spec} ${i.where}] ${i.title.slice(0, 220)} :: ${i.body.slice(0, 700)}\n`);
