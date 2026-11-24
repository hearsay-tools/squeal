// Probe 023-81: from an `strace -f` log, every create, rename target, delete and mkdir under <root>,
// with the writing process's class. usage: node writers.cjs <trace> <root> > writes.json
const fs = require("node:fs");
const readline = require("node:readline");
const [trace, root] = process.argv.slice(2);
const tgid = new Map(); // tid -> process id
const parent = new Map(); // process -> parent process
const argv = new Map(); // process -> argv text
const proc = (tid) => tgid.get(tid) ?? tid;
const out = [];
const rel = (p) => {
  if (!p.startsWith(root + "/") && p !== root) return null;
  const r = p.slice(root.length + 1);
  if (/(^|\/)(node_modules|\.git)(\/|$)/.test(r)) return null;
  return r;
};
const cls = (pid) => {
  const chain = [];
  for (let p = pid, n = 0; p !== undefined && n < 12; p = parent.get(p), n++) chain.push(argv.get(p) ?? "?");
  const a = chain[0];
  if (/squeal\.mjs daemon/.test(a)) return "squeal-daemon";
  if (/runner-host|host-vitest|vitest-host/.test(a)) return "squeal-runner-host";
  if (/vitest.*(forks|threads|worker)/.test(a)) return "vitest-worker";
  if (chain.slice(1).some((c) => /vitest.*(forks|threads|worker)/.test(c))) return `test-child:${a.slice(0, 60)}`;
  return `other:${a.slice(0, 80)} <= ${chain.slice(1, 3).map((c) => c.slice(0, 50)).join(" <= ")}`;
};
const rl = readline.createInterface({ input: fs.createReadStream(trace) });
rl.on("line", (line) => {
  const m = /^(\d+) (\S+) (\w+)\((.*)\) = (-?\d+|\?)/.exec(line);
  if (!m) return;
  const [, tidS, time, call, args, retS] = m;
  const tid = Number(tidS), ret = Number(retS), pid = proc(tid);
  if (call === "clone" || call === "clone3" || call === "fork" || call === "vfork") {
    if (!(ret > 0)) return;
    if (/CLONE_THREAD/.test(args)) tgid.set(ret, pid);
    else parent.set(ret, pid);
    return;
  }
  if (call === "execve") {
    const a = /\[(.*?)\]/.exec(args);
    argv.set(pid, a ? a[1].replace(/"/g, "").replace(/, /g, " ").slice(0, 200) : "?");
    return;
  }
  const strs = [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
  let kind = null, paths = [];
  if (call === "openat") { if (!/O_CREAT/.test(args)) return; kind = "create"; paths = [strs[0]]; }
  else if (call === "mkdir" || call === "mkdirat") { kind = "mkdir"; paths = [strs[0]]; }
  else if (call.startsWith("rename")) { kind = "rename"; paths = [strs[1], strs[0]]; }
  else if (call === "unlink" || call === "unlinkat" || call === "rmdir") { kind = "delete"; paths = [strs[0]]; }
  else if (call === "symlink" || call === "symlinkat") { kind = "symlink"; paths = [strs[strs.length - 1]]; }
  else if (call === "link" || call === "linkat") { kind = "link"; paths = [strs[1]]; }
  else return;
  const r = paths[0] && rel(paths[0]);
  if (r === null || r === undefined) return;
  out.push({ time, pid, tid, call: kind, path: r, from: kind === "rename" ? rel(paths[1] ?? "") : undefined, cls: null });
});
rl.on("close", () => {
  for (const w of out) w.cls = cls(w.pid);
  process.stdout.write(JSON.stringify(out));
});
