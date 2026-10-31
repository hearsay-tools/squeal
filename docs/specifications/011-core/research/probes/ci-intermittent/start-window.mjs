import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const repo = process.cwd();
const load = (p) => import(pathToFileURL(resolve(repo, p)).href);
const { runHook } = await load("src/harness/claude-code/index.ts");
const { ensureDaemon } = await load("src/core/daemon/ensure.ts");
const { requestDaemon } = await load("src/core/daemon/client.ts");
const { socketPathFor } = await load("src/core/daemon/paths.ts");
const { worktreeIdFor } = await load("src/core/fs/index.ts");
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const scratch = mkdtempSync("/tmp/sq-start-window-");
const root = join(scratch, "repo");
mkdirSync(root);
const runtime = join(scratch, "run");
mkdirSync(runtime, { mode: 0o700 });
writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(root, "squeal.config.json"),
  JSON.stringify({
    complexity: { enabled: false },
    lint: { enabled: false },
    coverage: { enabled: false },
  }),
);
writeFileSync(
  join(root, "vitest.config.ts"),
  'export default {test:{include:["test/**/*.test.ts"]}};\n',
);
execFileSync("git", ["init", "-q"], { cwd: root });
symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
const env = {
  ...process.env,
  XDG_RUNTIME_DIR: runtime,
  XDG_CONFIG_HOME: join(scratch, "config"),
  PROBE_MARKER: join(scratch, "paused"),
  NODE_OPTIONS: "--import=" + new URL("./start-window-preload.mjs", import.meta.url).href,
};
for (const k of Object.keys(env))
  if (/^(VITEST|GIT_)/.test(k) || ["PLUGIN_ROOT", "PLUGIN_DATA", "NODE_PATH"].includes(k))
    delete env[k];
const cli = join(repo, "plugins/claude-code/dist/cli/squeal.mjs");
const child = spawn(process.execPath, [cli, "daemon", root], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(child, "exit");
let stderr = "";
child.stderr.on("data", (b) => (stderr += b));
const socket = socketPathFor(worktreeIdFor(root), env);
const ping = () => requestDaemon(socket, { type: "ping" }, 500);
const calls = [];
const deps = {
  env: { ...env, SQUEAL_HOOK_DEBUG: "1" },
  harnessProcess: () => null,
  ensureDaemon: async (r, o) => {
    const result = await ensureDaemon(r, { ...o, cli, env });
    calls.push(result);
    return result;
  },
};
const hook = async (name, id, hookVersion = version) =>
  runHook(
    name,
    JSON.stringify({
      session_id: id,
      cwd: root,
      hook_event_name: name === "session-start" ? "SessionStart" : "PostToolUse",
    }),
    { ...deps, squealVersion: hookVersion },
  );
try {
  const deadline = Date.now() + 15000;
  while (!existsSync(env.PROBE_MARKER)) {
    if (Date.now() > deadline) throw new Error("no barrier " + stderr);
    await delay(10);
  }
  const first = await ping();
  const equal = [await hook("session-start", "equal"), await hook("post-tool-batch", "equal")];
  const newer = [
    await hook("session-start", "newer", "0.1.0"),
    await hook("post-tool-batch", "newer", "0.1.0"),
  ];
  console.log(
    JSON.stringify({
      phase: "marker-held",
      node: process.version,
      daemonPid: first.pid,
      daemonVersion: first.squealVersion,
      calls: [...calls],
      errors: [...equal, ...newer].map((x) => x.stderr),
    }),
  );
  await delay(2700);
  await hook("session-start", "settled");
  console.log(
    JSON.stringify({ phase: "marker-cleared", daemonPid: (await ping()).pid, calls: [...calls] }),
  );
} finally {
  await requestDaemon(socket, { type: "stop" }, 1000).catch(() => {});
  const done = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
  if (!done) {
    child.kill("SIGKILL");
    await exited;
  }
  rmSync(scratch, { recursive: true, force: true });
}
