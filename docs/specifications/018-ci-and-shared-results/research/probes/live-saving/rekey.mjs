import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/agent/projects/cezar/.git/squeal/store.sqlite', { readOnly: true });
const ci = new Map(db.prepare("select hash, json_extract(descriptor,'$.ci') ci from environments").all().map(r => [r.hash, r.ci]));
for (const i of db.prepare("select id, imported_at, json_extract(header,'$.commit') c, json_extract(header,'$.squealVersion') v from imports order by imported_at").all()) {
  let rek = 0, ex = 0, unk = 0;
  for (const f of db.prepare("select environment e from import_files where import_id=?").all(i.id)) { const c = ci.get(f.e); if (c === 1 || c === true || c === 'true') ex++; else if (c === undefined || c === null) unk++; else rek++; }
  console.log(new Date(i.imported_at).toISOString().slice(0,16), i.v, i.c.slice(0,8), 'rekeyed', rek, 'exportedKey', ex, 'unknownEnv', unk);
}
