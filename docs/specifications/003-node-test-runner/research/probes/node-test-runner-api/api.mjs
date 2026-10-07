import { run } from 'node:test';
import { writeFileSync, copyFileSync } from 'node:fs';
import { line } from './serialize.mjs';
const config = JSON.parse(process.argv[2]);
const { repeat, change, freshEntry, abortAfter, watchProbe, ...options } = config;
let timer;
const controller = new AbortController();
if (abortAfter) timer = setTimeout(() => controller.abort(), abortAfter);
for (let round = 0; round < (repeat ?? 1); round++) {
  if (round && change) writeFileSync(change.path, change.content);
  if (round && freshEntry) {
    const copy = options.files[0].replace('.test.ts', '-fresh.test.ts');
    copyFileSync(options.files[0], copy);
    options.files[0] = copy;
  }
  process.stdout.write(line({ type: 'probe:before', data: { round, node: process.version, exitCode: process.exitCode } }));
  let setupCalled = false;
  const stream = run({ ...options, signal: controller.signal, setup(s) {
    setupCalled = true;
    s.on('test:enqueue', () => {});
  }});
  let drains = 0;
  for await (const event of stream) {
    process.stdout.write(line(event));
    if (watchProbe && event.type === 'test:watch:drained') {
      if (++drains === 1) setTimeout(() => writeFileSync(change.path, change.content), 100);
      else controller.abort();
    }
  }
  process.stdout.write(line({ type: 'probe:after', data: { round, setupCalled, exitCode: process.exitCode } }));
}
clearTimeout(timer);
