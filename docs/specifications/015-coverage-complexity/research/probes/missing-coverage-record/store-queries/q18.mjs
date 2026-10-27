import { DatabaseSync } from "node:sqlite";
const dir = "/home/agent/projects/squeal/.git/squeal/";
const s = new DatabaseSync(dir + "store.sqlite", { readOnly: true });
s.exec(`attach database 'file:${dir}code.sqlite?mode=ro' as c`);
const since = Date.parse(process.argv[2]), PAUSE = Number(process.argv[3]);
const ts = s.prepare("select recorded_at t from c.coverage where recorded_at > ? order by recorded_at").all(since).map(r => r.t);
// Control: the instants a completed run ended (each the moment its first job is due). Share of them inside a pause >= PAUSE.
const ends = s.prepare("select ended_at t from runs where end_state='completed' and ended_at > ? and ended_at < ?").all(since, ts.at(-1)).map(r => r.t);
let j = 0, inside = 0;
for (const e of ends.sort((a,b)=>a-b)) {
  while (j < ts.length && ts[j] <= e) j++;
  if (j > 0 && j < ts.length && ts[j] - ts[j-1] >= PAUSE) inside++;
}
console.log({ PAUSE, runEnds: ends.length, endsInsideAPause: inside, share: (100 * inside / ends.length).toFixed(1) + "%" });
