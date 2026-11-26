// Throwaway preload. Counts actual SQLite calls, not SQL guessed from syscalls.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { syncBuiltinESMExports } from 'node:module';
const started = performance.now();
const counts = { sql: {}, fs: {} };
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function(sql) {
  const stmt = prepare.call(this, sql);
  for (const method of ['get', 'all', 'run', 'iterate']) {
    const fn = stmt[method];
    stmt[method] = function(...args) {
      const key = method + ' ' + sql.replace(/\s+/g, ' ').trim();
      counts.sql[key] = (counts.sql[key] ?? 0) + 1;
      return fn.apply(this, args);
    };
  }
  return stmt;
};
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function(sql) {
  const key = 'exec ' + sql.replace(/\s+/g, ' ').trim();
  counts.sql[key] = (counts.sql[key] ?? 0) + 1;
  return exec.call(this, sql);
};
for (const key of ['readFileSync', 'statSync', 'lstatSync', 'existsSync', 'realpathSync', 'openSync']) {
  const fn = fs[key];
  const wrapped = function(...args) {
    const name = key + ' ' + String(args[0]);
    counts.fs[name] = (counts.fs[name] ?? 0) + 1;
    return fn.apply(this, args);
  };
  Object.assign(wrapped, fn);
  fs[key] = wrapped;
}
syncBuiltinESMExports();
process.on('exit', () => fs.writeFileSync(process.env.PROBE_LOG, JSON.stringify({ ...counts, preloadToExitMs: performance.now()-started, loadedAtMs: globalThis.__sqLoaded, exitAtMs: performance.now() }, null, 2)));
