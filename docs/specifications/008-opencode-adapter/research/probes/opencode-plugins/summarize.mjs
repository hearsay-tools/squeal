// Keep relevant probe fields; exclude recursive session.diff snapshots.
import {readFileSync,writeFileSync} from 'node:fs';
const rows=readFileSync('probe.jsonl','utf8').trim().split('\n').map(JSON.parse);
const summary={hooks:[...new Set(rows.map(x=>x.kind))],events:[...new Set(rows.filter(x=>x.kind==='event').map(x=>x.type))],rows:rows.filter(x=>x.kind!=='event'||['session.created','session.idle','session.error','session.deleted','file.edited'].includes(x.type))};
writeFileSync(process.argv[2]||'summary.json',JSON.stringify(summary,null,2)+'\n');
