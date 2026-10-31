import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { describe, it, expect } from 'vitest';
import { createDeliveryHost } from '../../../../../../src/harness/pi/host.js';
import { startSession, toolBoundary } from '../../../../../../src/harness/pi/session.js';
import { squealRepo, SESSION } from '../../../../../../test/harness/helpers.js';
import { tempDir } from '../../../../../../test/store/helpers.js';

// Throwaway transport probe. Real handlers/store; no real harness or daemon.
const deps = { env: {}, ensureDaemon: async () => 'alive' as const };
const src = (path: string) => JSON.stringify(resolve('src', path));
async function entry(mode: string, dir: string) {
  const code = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { setTimeout as sleep } from 'node:timers/promises';
    import { parentPort, workerData } from 'node:worker_threads';
    import { handle } from ${src('harness/pi/worker.ts')};
    import { runHandler } from ${src('harness/claude-code/run.ts')};
    import { postToolBatch } from ${src('harness/claude-code/hooks/post-tool-batch.ts')};
    import { runCodexHandler } from ${src('harness/codex/run.ts')};
    import { postToolUse } from ${src('harness/codex/handlers.ts')};
    const deps = { env: {}, ensureDaemon: async () => 'alive' };
    const mode = ${JSON.stringify(mode)};
    async function run(request, mark, hold) {
      const input = JSON.stringify({ session_id: request.sessionId, cwd: request.cwd,
        hook_event_name: mode === 'claude' ? 'PostToolBatch' : 'PostToolUse',
        tool_names: ['Read'], tool_name: 'Bash' });
      const answer = mode === 'pi' ? await handle(request, deps) : mode === 'claude'
        ? (await runHandler('post-tool-batch', postToolBatch, input, deps)).stdout
        : (await runCodexHandler('post-tool-use', postToolUse, input, deps)).stdout;
      writeFileSync(mark, JSON.stringify({ answer, preparedAt: Date.now() }));
      if (hold) await sleep(3000); // asynchronous delay AFTER delivery commit
      return answer;
    }
    if (mode === 'pi') {
      parentPort.on('message', async ({ id, request }) => {
        const answer = await run(request, workerData.mark, workerData.hold);
        parentPort.postMessage({ id, ok: true, answer });
      });
    } else {
      const { request, mark, hold } = JSON.parse(readFileSync(0, 'utf8'));
      process.stdout.write(await run(request, mark, hold));
    }
  `;
  const outfile = join(dir, `${mode}.mjs`);
  await build({stdin: {contents: code, resolveDir: process.cwd(), loader: 'ts'},
    outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    banner: {js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'},
    logLevel: 'silent'});
  return outfile;
}

async function pipe(entry: string, input: object, cwd: string) {
  return new Promise<{text: string; killed: boolean}>((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
      cwd, env: { PATH: process.env.PATH, HOME: cwd }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let text = '', error = '', killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 2000);
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code && !killed) reject(new Error(error));
      else resolve({ text, killed });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

describe('delivery receipt: real store and handlers, held transport', () => {
  for (const mode of ['claude', 'codex', 'pi']) {
    for (const hold of [false, true]) {
      it(`${mode}: ${hold ? 'deadline after commit' : 'normal control'}`, async () => {
        const r = squealRepo();
        r.policy({});
        r.apply(r.pass());
        await startSession({ sessionId: SESSION, cwd: r.root, reason: 'startup' }, deps);
        r.apply(r.fail());
        const dir = tempDir('squeal-receipt-');
        const file = await entry(mode, dir);
        const mark = join(dir, 'prepared.json');
        const request = { kind: 'boundary' as const, sessionId: SESSION, cwd: r.root, edited: false };
        const began = Date.now();
        let received: string | null, killed: boolean | null;
        if (mode === 'pi') {
          const host = createDeliveryHost(() => new Worker(file, {
            workerData: { mark, hold }, env: { PATH: process.env.PATH, HOME: dir },
          }));
          try { received = await host.call(request, 2000); killed = received === null; }
          finally { host.stop(); }
        } else {
          const answer = await pipe(file, { request, mark, hold }, dir);
          received = answer.text; killed = answer.killed;
        }
        expect(existsSync(mark)).toBe(true); // proves timeout was AFTER commit
        const prepared = JSON.parse(readFileSync(mark, 'utf8'));
        expect(prepared.answer).toContain('PASS -> FAIL');
        const view = r.store.views.list(r.consumer()).find(v => v.check.kind === 'test');
        expect(view?.outcome).toBe('fail');
        expect(killed).toBe(hold);
        if (hold) expect(received || null).toBeNull();
        else expect(received).toContain('PASS -> FAIL');
        const next = await toolBoundary({ sessionId: SESSION, cwd: r.root }, deps, false);
        expect(next ?? '').not.toContain('PASS -> FAIL');
        console.log(JSON.stringify({ mode, hold, preparedMs: prepared.preparedAt - began,
          totalMs: Date.now() - began, receivedTransition: received?.includes('PASS -> FAIL') ?? false,
          view: view?.outcome, nextTransition: next?.includes('PASS -> FAIL') ?? false }));
      });
    }
  }
});
