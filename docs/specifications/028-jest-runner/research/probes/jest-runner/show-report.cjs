// Throwaway probe (spec 028 research). Prints a streaming-reporter file compactly.
for (const l of require('fs').readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const o = JSON.parse(l); delete o.at; delete o.pid;
  if (o.file) o.file = o.file.split('/').slice(-1)[0];
  if (o.e === 'case') { console.log('  case', o.file, JSON.stringify(o.ancestorTitles), JSON.stringify(o.title), o.status, o.location ? 'loc' : ''); continue; }
  if (o.perf) o.perf = { runtime: o.perf.runtime };
  if (o.cases) o.cases = o.cases.map((c) => `${c.ancestorTitles.join('>')}>${c.title}=${c.status}`).join(' | ');
  console.log(JSON.stringify(o));
}
