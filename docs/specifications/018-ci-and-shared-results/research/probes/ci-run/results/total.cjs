const fs = require("fs");
for (const f of process.argv.slice(2)) {
  const rows = fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  let sameS = 0, allS = 0, sameN = 0, allN = 0, nonE2eS = 0;
  for (const r of rows) { sameS += r.seconds.same; allS += sum(r.seconds); sameN += r.counts.same; allN += sum(r.counts); nonE2eS += sum(r.seconds) - r.seconds.e2e; }
  console.log(f, { transitions: rows.length, envChanged: rows.filter((r) => !r.envSame).length, lockChanged: rows.filter((r) => !r.lockSame).length,
    sameFiles: sameN, allFiles: allN, pctFiles: (100 * sameN / allN).toFixed(1), sameSeconds: sameS, allSeconds: allS, pctSeconds: (100 * sameS / allS).toFixed(1),
    allSameTransitions: rows.filter((r) => r.counts.changed + r.counts.new + r.counts.noClosure === 0).length });
}
