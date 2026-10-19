// usage: node runlog.cjs <probe-dir> <min-revision>: each run's files, completed, withheld, failure
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const dir = `${process.argv[2]}/repo/.git/squeal`;
const db = new DatabaseSync(`${dir}/store.sqlite`, { readOnly: true });
const rows = db.prepare("select id, revision, test_files from runs where revision >= ? order by started_at").all(Number(process.argv[3] ?? 0));
for (const { id, revision, test_files } of rows) {
  const file = `${dir}/runs/${id}/report.json`;
  const rep = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).report : {};
  const paths = (l) => (l ?? []).map((f) => f.path);
  console.log(revision, paths(JSON.parse(test_files)), "completed:", paths(rep.completedFiles), "withheld:", paths(rep.withheld), "\n   failure:", rep.failure ?? null);
}
