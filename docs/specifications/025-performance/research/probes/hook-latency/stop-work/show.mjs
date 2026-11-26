import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const min = Number(process.argv[3] ?? 0);
console.log("afterLoad", d.afterLoad.toFixed(1));
for (const b of ["sql", "fs"]) {
  const rows = Object.entries(d[b]).sort((x, y) => y[1].ms - x[1].ms);
  let tot = 0, n = 0;
  for (const [k, e] of rows) { tot += e.ms; n += e.n; }
  console.log(`== ${b}: ${n} calls, ${tot.toFixed(2)} ms`);
  for (const [k, e] of rows) {
    if (e.ms < min && e.n < 3) continue;
    console.log(`${e.n}\t${e.ms.toFixed(2)}\t${k}`);
    if (process.argv[4]) for (const [c, n] of Object.entries(e.callers)) console.log(`\t\t${n} ${c.slice(0, 250)}`);
  }
}
