// Throwaway: drive the actual installed Cezar PiRunner without creating a Cezar task.
import { writeFileSync } from 'node:fs';
import { PiRunner, buildPiArgs } from '/home/squeal-e2e/pi-sessions-packaging-probe/cezar-source/dist/core/pi-runner.js';
if (process.getuid() !== 1002) throw new Error('must run as squeal-e2e');
const root = '/home/squeal-e2e/pi-sessions-packaging-probe';
const results = {};
for (const [autoEndAfterFirstTurn, delay] of [[false, 200], [true, 200], [true, 600]]) {
  const events = [], ui = [];
  const runner = new PiRunner({ bin: '/home/squeal-e2e/.npm-global/bin/pi', timeoutMs: 6000 });
  const spec = { cwd: root, userPrompt: 'seed', model: 'squeal-fake/scripted', env: { PI_CODING_AGENT_DIR: root + '/agent', PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', PROBE_LOG: root + `/cezar-${autoEndAfterFirstTurn}-${delay}.jsonl`, PROBE_WAKE: 'custom-steer', PROBE_WAKE_DELAY: String(delay) } };
  writeFileSync(spec.env.PROBE_LOG, '');
  let settled = 0;
  const session = runner.startSession(spec, event => {
    events.push(event);
    if (event.type === 'turn-end' && ++settled === 2 && !autoEndAfterFirstTurn) setTimeout(() => session.end(), 20);
  }, { autoEndAfterFirstTurn, onUiEvent: event => ui.push(event) });
  const result = await session.result;
  results[`${autoEndAfterFirstTurn}-${delay}`] = { args: buildPiArgs(spec), events, uiTypes: ui.map(event => event.type), result };
}
writeFileSync(root + '/cezar-results.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
