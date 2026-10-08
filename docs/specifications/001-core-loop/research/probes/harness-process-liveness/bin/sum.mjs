import { readFileSync } from 'node:fs';
for (const l of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const r = JSON.parse(l);
  const ch = r.chain.slice(1).map((c) => `${c.pid}:${c.comm}${c.exe ? '[' + c.exe.split('/').pop() + ']' : ''}`).join(' < ');
  console.log(`${r.event?.padEnd(16)} ${r.label.padEnd(13)} agent=${(r.agent_id ?? '-').slice(0, 8)} walk=${r.walkUs.toFixed(0)}us hook=${r.pid} < ${ch}`);
}
