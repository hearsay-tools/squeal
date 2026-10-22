// Vitest reporter that appends one NDJSON line per watch event with a wall-clock time.
// WM_LOG names the file. Throwaway (011-119).
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const log = (o) => appendFileSync(process.env.WM_LOG, JSON.stringify({ t: Date.now() / 1000, ...o }) + '\n');
let root = '';
const rel = (f) => path.relative(root, f);
export default class StampReporter {
  onInit(v) { root = v.config.root; log({ ev: 'init' }); }
  onWatcherRerun(files, trigger) { log({ ev: 'rerun', trigger: trigger && rel(trigger), files: files.map(rel) }); }
  onTestRunStart(specs) { log({ ev: 'start', files: specs.map((s) => rel(s.moduleId)) }); }
  onTestModuleEnd(m) { log({ ev: 'moduleEnd', file: rel(m.moduleId), state: m.state() }); }
  onTestRunEnd(mods, errors, reason) {
    log({ ev: 'end', reason, errors: errors.length, modules: mods.map((m) => ({ file: rel(m.moduleId), state: m.state() })) });
  }
}
