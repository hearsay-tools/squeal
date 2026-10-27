// Throwaway probe runner. Hooks deliberately cover only the APIs named here.
import fs from 'node:fs';
import child from 'node:child_process';
import inspector from 'node:inspector';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, test, mode] = process.argv.slice(2);
const originalRead = fs.readFileSync;
const observations = { reads: [], child: false, reflection: false };
if (mode === 'coverage') {
fs.readFileSync = function (path, ...args) {
  const value = originalRead.call(this, path, ...args);
  const absolute = path instanceof URL ? path.pathname : resolve(String(path));
  if (absolute.startsWith(`${root}/`)) observations.reads.push(relative(root, absolute));
  return value;
};
const originalExec = child.execFileSync;
child.execFileSync = function (...args) {
  observations.child = true;
  return originalExec.apply(this, args);
};
const originalToString = Function.prototype.toString;
Function.prototype.toString = function () {
  observations.reflection = true;
  return originalToString.call(this);
};
syncBuiltinESMExports();
}
const session = new inspector.Session();
const post = (name, params = {}) => new Promise((ok, no) => session.post(name, params, (e, r) => e ? no(e) : ok(r)));
if (mode !== 'plain') {
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}
const start = performance.now();
const cpu = process.cpuUsage();
let failure = null;
try { await import(pathToFileURL(resolve(root, test)).href); }
catch (error) { failure = { name: error.name, message: error.message }; }
const executeCpu = process.cpuUsage(cpu);
const executeMs = performance.now() - start;
const coverage = mode !== 'plain' ? (await post('Profiler.takePreciseCoverage')).result.filter(s => s.url.startsWith(pathToFileURL(root).href)) : [];
if (mode !== 'plain') session.disconnect();
process.stdout.write(JSON.stringify({ failure, observations, coverage, executeMs, executeCpu }));
