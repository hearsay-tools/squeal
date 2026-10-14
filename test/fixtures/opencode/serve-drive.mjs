// Spec 008 isolation check: one `opencode serve` turn, the way `test/helpers/opencode.ts` drives
// it. Starts the given command (strace running OpenCode), waits for its "listening on" line,
// creates a session for <dir>, sends <prompt> and waits for the reply, then SIGTERMs OpenCode,
// the command's child.
//   node serve-drive.mjs <dir> <prompt> <command> [args...]
// Only node builtins; run as squeal-e2e by isolation-check.sh.
import { spawn, spawnSync } from "node:child_process";

const [dir, prompt, command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
const exited = new Promise((done) => child.on("exit", (code, signal) => done(`${code} ${signal}`)));
let out = "";
const url = await new Promise((done, fail) => {
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    out += chunk;
    const match = out.match(/listening on (http:\/\/\S+)/);
    if (match) done(match[1]);
  });
  child.on("exit", () => fail(new Error(`serve exited before listening:\n${out}`)));
});
const headers = { "content-type": "application/json", "x-opencode-directory": dir };
const post = async (path, body) => {
  const res = await fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
try {
  const session = await post("/session", {});
  const reply = await post(`/session/${session.id}/message`, { parts: [{ type: "text", text: prompt }] });
  console.log(JSON.stringify({ session: session.id, parts: reply.parts?.map((part) => part.type) }));
} finally {
  spawnSync("pkill", ["-TERM", "-P", String(child.pid)]);
  console.error(`exit ${await exited}`);
  clearTimeout(timer);
}
