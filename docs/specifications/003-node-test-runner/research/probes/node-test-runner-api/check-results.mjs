import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const versions = ['v22.23.3', 'v24.21.0'];
let count = 0;
function check(condition, message) { assert.ok(condition, message); count++; }
for (const version of versions) {
  const d = JSON.parse(readFileSync(new URL('results/'+version+'.json',import.meta.url),'utf8'));
  const c = d.cases;
  check(c['api-events'].code === 0 && c['cli-destination'].code === 1, version+' exit semantics');
  check(c['api-events'].summaries.at(-1).success === false, version+' failure summary');
  check(c['api-filter-none'].events.some(e=>e.type==='test:stdout' && e.data.message.includes('module-evaluated')), version+' filter executes module');
  check(c['api-only'].results.length === 1 && c['api-only'].results[0].name === 'only target', version+' only');
  const duplicates = c['api-source-maps'].results.filter(r=>r.name==='duplicate');
  check(duplicates.map(r=>r.line).join(',') === '13,14,15', version+' mapped declarations');
  check(c['api-events'].results.filter(r=>r.name==='duplicate').every(r=>r.line===1), version+' unmapped declarations');
  check(c['repeat-process'].results.map(r=>r.name).join(',') === 'value 1,value 2', version+' process freshness');
  check(c['repeat-none-fresh-entry'].results.map(r=>r.name).join(',') === 'value 1,value 1', version+' stale dependency');
  check(c['api-watch'].results.map(r=>r.name).join(',') === 'value 1,value 2', version+' watch freshness');
  check(c['cli-native-enum'].code === 1 && c['cli-tsx-enum'].code === 0, version+' TS features');
  check(c['cli-snapshot-missing'].code === 1 && c['cli-snapshot-update'].code === 0 && c['cli-snapshot-read'].code === 0, version+' snapshot lifecycle');
  check(c['cli-coverage'].events.some(e=>e.type==='test:coverage'), version+' coverage');
  check(c['api-abort'].code === 0 && !c['api-abort'].watchdog, version+' abort terminates');
  for (const name of ['api-import','api-syntax']) check(c[name].results.length===1 && c[name].results[0].type==='test:fail' && c[name].events.some(e=>e.type==='test:stderr'), version+' '+name);
  for (const name of ['api-timeout','cli-timeout','api-block-timeout','cli-block-timeout']) check(c[name].watchdog === (version==='v24.21.0'), version+' '+name+' watchdog');
  for (const [name, result] of Object.entries(c)) if (name.startsWith('bench-')) check(result.code === 0 && result.summaries.at(-1).success === true && result.summaries.at(-1).counts.tests === (name.includes('one') && !name.includes('none') ? 1 : 20), version+' '+name);
}
console.log(`${count} recorded-observation checks passed on Node 22.23.3 and 24.21.0.`);
