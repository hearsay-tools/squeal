// Throwaway. Per-file wall time from a Vitest JSON report: node summarise.mjs <report.json>
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const f of r.testResults.sort((a, b) => a.name.localeCompare(b.name))) {
  const n = f.assertionResults.length;
  const failed = f.assertionResults.filter((a) => a.status === "failed").length;
  console.log(`${f.name.split("/").slice(-1)[0]}\tms=${f.endTime - f.startTime}\ttests=${n}\tfailed=${failed}`);
}
console.log(`total tests=${r.numTotalTests} failed=${r.numFailedTests}`);
