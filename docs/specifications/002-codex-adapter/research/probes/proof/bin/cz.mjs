// Throwaway: drive one `codex app-server` thread the way Cezar's
// codex-app-server-runner does (initialize, configRequirements/read,
// thread/start with cwd and full-access overrides, turn/start per prompt,
// then stdin EOF with a SIGTERM only after a grace), logging every message
// with a ms timestamp to $AS_LOG.
//   node cz.mjs <cwd> <step>...
// Steps run in order: a prompt file is one turn; `sh:<cmd>` runs a shell
// command (e.g. stopping the daemon); `review:inline` or `review:detached`
// runs `review/start` on the uncommitted changes and waits for it.
import { execSync, spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const cwd = args.shift();
const log = process.env.AS_LOG ?? "/tmp/p16/logs/as.jsonl";
const t0 = Date.now();
const rec = (dir, msg) => appendFileSync(log, `${JSON.stringify({ t: Date.now(), dir, msg })}\n`);
const note = (s) => {
  rec("note", { note: s });
  console.log(`+${Date.now() - t0}ms ${s}`);
};

const child = spawn("codex", ["app-server"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
let id = 1;
const pending = new Map();
let buf = "";
let threadId;
let turnDone;
const watched = new Set();
child.stdout.on("data", (d) => {
  buf += d;
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    rec("in", msg);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "turn/completed" && watched.has(msg.params?.threadId)) turnDone?.(msg);
    else if (msg.method === "hook/completed") {
      const r = msg.params?.run ?? msg.params;
      note(`hook ${r?.eventName} ${r?.status} ${r?.durationMs}ms thread=${msg.params?.threadId}`);
    }
  }
});
const exited = new Promise((r) => child.on("exit", (code, sig) => r({ code, sig })));
const send = (method, params) =>
  new Promise((res) => {
    const m = { id: id++, method, params };
    pending.set(m.id, res);
    rec("out", m);
    child.stdin.write(`${JSON.stringify(m)}\n`);
  });
const notify = (method, params) => {
  const m = { method, params };
  rec("out", m);
  child.stdin.write(`${JSON.stringify(m)}\n`);
};
const turn = async (input) => {
  const done = new Promise((r) => (turnDone = r));
  const s = await send("turn/start", { threadId, input: [{ type: "text", text: input }] });
  if (s.error) throw new Error(JSON.stringify(s.error));
  const end = await Promise.race([done, new Promise((r) => setTimeout(() => r("timeout"), 600_000))]);
  note(`turn end ${JSON.stringify(end?.params?.turn?.status ?? end)}`);
};

await send("initialize", { clientInfo: { name: "squeal-proof", title: null, version: "0" } });
notify("initialized", {});
await send("configRequirements/read", {});
const t = await send("thread/start", { cwd, sandbox: "danger-full-access", approvalPolicy: "never" });
if (t.error) throw new Error(JSON.stringify(t.error));
threadId = t.result.thread.id;
note(`thread ${threadId}`);
watched.add(threadId);
for (const step of args) {
  if (step.startsWith("sh:")) note(`sh: ${execSync(step.slice(3), { encoding: "utf8", cwd }).trim()}`);
  else if (step.startsWith("review:")) {
    const done = new Promise((r) => (turnDone = r));
    const r = await send("review/start", {
      threadId,
      target: { type: "uncommittedChanges" },
      delivery: step.slice(7),
    });
    if (r.result?.reviewThreadId) watched.add(r.result.reviewThreadId);
    note(`review/start ${JSON.stringify(r.error ?? r.result)}`);
    if (r.error) continue;
    const end = await Promise.race([done, new Promise((res) => setTimeout(() => res("timeout"), 600_000))]);
    note(`review end ${JSON.stringify(end?.params?.turn?.status ?? end)}`);
  } else await turn(readFileSync(step, "utf8"));
}
note("stdin EOF");
child.stdin.end();
const term = setTimeout(() => {
  note("SIGTERM after 10 s grace");
  child.kill("SIGTERM");
}, 10_000);
const ex = await exited;
clearTimeout(term);
note(`app-server exit ${JSON.stringify(ex)}`);
process.exit(0);
