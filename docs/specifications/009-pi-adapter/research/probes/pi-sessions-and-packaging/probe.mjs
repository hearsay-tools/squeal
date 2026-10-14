// Throwaway Pi 1.0.4 research extension. No network or real provider credentials.
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';

export default function (pi) {
  const log = (type, data = {}) => appendFileSync(process.env.PROBE_LOG, JSON.stringify({ type, ...data }) + '\n');
  const factory = crypto.randomUUID();
  let ctx;
  let request = 0;
  let wakeTimer;
  log('factory', { factory, uid: process.getuid(), node: process.execPath, module: import.meta.url, net: typeof createServer });
  pi.registerProvider('squeal-fake', {
    api: 'squeal-fake-api', apiKey: 'not-a-credential', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 2048 }],
    streamSimple(model, context) {
      const stream = new AssistantMessageEventStream();
      log('request', { request: ++request, messages: context.messages });
      const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [], stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: message });
        if (process.env.PROBE_BASH && request === 1) {
          message.content.push({ type: 'toolCall', id: 'bash-1', name: 'bash', arguments: { command: 'printf "consumer=%s native=%s file=%s\\n" "$SQUEAL_PROBE_SESSION" "$PI_SESSION_ID" "$PI_SESSION_FILE"; command -v squeal || true' } });
          message.stopReason = 'toolUse';
          stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
          stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: message.content[0], partial: message });
        } else {
          message.content.push({ type: 'text', text: `FAKE_REPLY_${request}` });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: message.content[0].text, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: message.content[0].text, partial: message });
        }
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      });
      return stream;
    },
  });
  for (const event of ['session_start', 'session_shutdown', 'session_before_switch', 'session_switch', 'session_before_fork', 'session_fork', 'session_before_compact', 'session_compact', 'agent_start', 'agent_end', 'agent_settled']) {
    pi.on(event, (ev, context) => {
      ctx = context;
      const session = context.sessionManager.getSessionId();
      log(event, { event: ev, session, file: context.sessionManager.getSessionFile(), factory, mode: context.mode, cwd: context.cwd });
      process.env.SQUEAL_PROBE_SESSION = session;
      if (event === 'session_shutdown') clearTimeout(wakeTimer);
      if (event === 'session_start' && process.env.PROBE_DAEMON) {
        const child = spawn(process.execPath, [fileURLToPath(new URL('./sentinel.mjs', import.meta.url)), process.env.PROBE_DAEMON], { detached: true, stdio: 'ignore' });
        child.unref();
        writeFileSync(process.env.PROBE_DAEMON + '.pid', String(child.pid));
      }
      if (event === 'agent_settled' && process.env.PROBE_WAKE && request === 1) {
        // Timer intentionally runs after the ordinary first run has settled.
        wakeTimer = setTimeout(() => wake(process.env.PROBE_WAKE), Number(process.env.PROBE_WAKE_DELAY || 200));
      }
    });
  }
  function wake(kind) {
    log('wake', { kind, idle: ctx.isIdle(), session: ctx.sessionManager.getSessionId() });
    if (kind.startsWith('user')) pi.sendUserMessage(`WAKE_${kind}`, { deliverAs: kind.endsWith('followUp') ? 'followUp' : 'steer' });
    else pi.sendMessage({ customType: 'squeal-probe', content: `WAKE_${kind}`, display: true }, { triggerTurn: kind !== 'custom-silent', deliverAs: kind === 'custom-nextTurn' ? 'nextTurn' : kind.endsWith('followUp') ? 'followUp' : 'steer' });
  }
  pi.registerCommand('probe-wake', { description: 'Throwaway idle injection', handler: async (args, context) => { ctx = context; wake(args); } });
}
