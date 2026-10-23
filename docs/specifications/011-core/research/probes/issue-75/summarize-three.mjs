// Throwaway: summarizes three-versions.mjs logs. Usage: node summarize-three.mjs <log>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

for (const file of process.argv.slice(2)) {
  const events = readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const host = events.find((e) => e.event === 'host');
  console.log(`== ${basename(file)}: mode ${host.mode}, load ${host.load} on ${host.cpus} CPUs, ${host.node}, start ${host.at}`);
  const daemons = events.filter((e) => e.event === 'daemon-process');
  const byCode = {};
  for (const d of daemons) byCode[`${d.code} from ${d.cli.split('/').slice(-5, -3).join('/')}${d.awaitLock ? ' --await-lock' : ''}`] = (byCode[`${d.code} from ${d.cli.split('/').slice(-5, -3).join('/')}${d.awaitLock ? ' --await-lock' : ''}`] ?? 0) + 1;
  console.log(`daemon processes: ${daemons.length}`, JSON.stringify(byCode));
  const registered = events.filter((e) => e.event === 'record' && e.live === 1 && e.claim === null);
  const incarnations = new Map();
  for (const r of events.filter((e) => e.event === 'record' && e.started)) incarnations.set(r.started, r.version);
  const versions = {};
  for (const v of incarnations.values()) versions[v] = (versions[v] ?? 0) + 1;
  console.log(`daemon incarnations recorded: ${incarnations.size}`, JSON.stringify(versions));
  const claims = new Set(events.filter((e) => e.event === 'record' && e.claim).map((e) => e.claim.at));
  const exits = events.filter((e) => e.event === 'note' && e.exitOf);
  console.log(`claims: ${claims.size}; exit notes: ${exits.length}; registrations seen: ${registered.length}`);
  const hooks = events.filter((e) => e.event === 'hook');
  const notices = hooks.filter((h) => h.headline.trim() !== '');
  const handing = notices.filter((h) => h.headline.includes('handing over')).length;
  const again = notices.filter((h) => h.headline.includes('validating again')).length;
  console.log(`hooks: ${hooks.length} (${hooks.filter((h) => h.code !== 0 || h.signal).length} not exit 0); with a notice: ${notices.length}; handing over: ${handing}; validating again: ${again}; largest hook ms: ${Math.max(...hooks.map((h) => h.ms))}`);
  for (const h of hooks.filter((x) => x.name === 'stop')) console.log(`  stop at ${h.t} ms: decision ${h.decision}; ${h.headline.trim().slice(0, 200)}`);
  for (const e of events.filter((x) => ['status-wait', 'start', 'final-status', 'writer', 'edit', 'codex-install', 'cleanup', 'skipped'].includes(x.event))) {
    const { at, event, ...rest } = e;
    console.log(`  ${event}: ${JSON.stringify(rest).slice(0, 420)}`);
  }
  const versionsSince = [...new Set(notices.map((h) => (h.headline.match(/handing over from (\S+) to (\S+) since (\S+)/) ?? []).slice(1).join(' ')).filter(Boolean))];
  console.log(`distinct handover notices (from to since): ${versionsSince.length}`);
  for (const v of versionsSince.slice(0, 6)) console.log(`  ${v}`);
}
