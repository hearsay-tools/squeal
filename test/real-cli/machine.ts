import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { CLI_BIN, type Ran, RUNS, runIsolated } from "./isolated.js";

/*
 * A scratch machine for row 005-17 (spec 005 Testing, end to end), built and
 * read only as the throwaway user, through `runIsolated`: its own HOME,
 * TMPDIR, CODEX_HOME, CLAUDE_CONFIG_DIR and XDG_RUNTIME_DIR under
 * `/home/squeal-e2e/runs/<id>/`; the user's pinned `claude` and `codex`
 * linked into its PATH, one or both; and a hub `hearsay` whose entries pin a
 * `file://` tool repository holding the candidate's plugins, never
 * `hearsay-tools/marketplace`. The candidate is `SQ_REAL_CLI_CANDIDATE`,
 * default HEAD, taken in by `git archive`.
 */

export type HarnessCli = "claude" | "codex";

/** The commit under test. */
export const CANDIDATE = execFileSync(
  "git",
  ["rev-parse", "--verify", `${process.env.SQ_REAL_CLI_CANDIDATE ?? "HEAD"}^{commit}`],
  { cwd: REPO_ROOT, encoding: "utf8" },
).trim();

const show = (path: string) =>
  execFileSync("git", ["show", `${CANDIDATE}:${path}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 });

/** The version the candidate's plugins carry: what the hub serves first. */
export const BASE_VERSION = (
  JSON.parse(show("plugins/claude-code/.claude-plugin/plugin.json").toString("utf8")) as {
    version: string;
  }
).version;

/** A later version than `BASE_VERSION`, as the next release would carry. */
export function laterVersion(by = 100): string {
  const [major, minor, patch] = BASE_VERSION.split(".").map(Number);
  return `${major}.${minor}.${(patch ?? 0) + by}`;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly input?: string | Buffer;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly preserve?: readonly string[];
}

export interface Machine {
  readonly root: string;
  readonly home: string;
  readonly claudeConfig: string;
  readonly codexHome: string;
  /** The hub's Git URL, as `SQUEAL_MARKETPLACE` names it to `install.sh`. */
  readonly hub: string;
  readonly launcher: string;
  readonly env: Readonly<Record<string, string>>;
  run(cmd: string, args: readonly string[], options?: RunOptions): Promise<Ran>;
  /** `sh -c script sh args…`. */
  sh(script: string, args?: readonly string[], options?: RunOptions): Promise<Ran>;
  /** A file's text, or `null` when it does not exist. */
  read(path: string): Promise<string | null>;
  /** Serves `version` from the hub in both harnesses: a tool repository commit and a new pin. */
  publish(version: string): Promise<void>;
  /** `install.sh` of the candidate as `curl … | sh` runs it; `args` after `sh -s --`. */
  install(...args: string[]): Promise<Ran>;
  /** The launcher by name from the PATH: `squeal <args>` in `cwd`. */
  squeal(args: readonly string[], cwd: string, options?: RunOptions): Promise<Ran>;
  /** Stops every daemon a fixture started and removes the case, unless `SQ_REAL_CLI_KEEP` is set. */
  dispose(): Promise<void>;
}

/** Throws with what the command printed unless it exited 0. */
export function ok(r: Ran, what: string): Ran {
  if (r.status !== 0)
    throw new Error(
      `${what}: exit ${r.status ?? r.signal}${r.timedOut ? " (timed out)" : ""}\n${r.stdout}\n${r.stderr}`,
    );
  return r;
}

/** The repository markers Claude Code and Codex read instructions from (`evals/lib/root.mjs`). */
const MARKERS = ".git CLAUDE.md AGENTS.md .claude";

const BOOTSTRAP = `set -eu
R=$1; shift
for d in "$R" ${RUNS} /home/squeal-e2e /home /; do
  for f in ${MARKERS}; do
    [ ! -e "$d/$f" ] || { echo "refused: $d/$f is a repository marker above the case" >&2; exit 1; }
  done
done
mkdir -p home/.claude home/.local codex tmp run bin fx src
chmod 700 run
for h in "$@"; do ln -s "${CLI_BIN}/$h" "bin/$h"; done
printf '[init]\\n\\tdefaultBranch = main\\n[advice]\\n\\tdetachedHead = false\\n' > home/.gitconfig
`;

/**
 * The hub's server: `git http-backend` behind HTTP on 127.0.0.1, serving the
 * case root. Neither CLI takes a `file://` marketplace ("expected owner/repo,
 * a git URL, or a local marketplace path"); Codex upgrades only a Git
 * marketplace, and Claude Code clones it shallow, which dumb HTTP refuses.
 * `node -e` with the root and port: run as the throwaway user, until the
 * case's teardown kills what names its root.
 */
const HUB_SERVER = `const http = require("node:http");
const { spawn } = require("node:child_process");
const [root, port] = process.argv.slice(1);
http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const h = req.headers;
  const cgi = spawn("git", ["http-backend"], { env: { ...process.env,
    GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: decodeURIComponent(url.pathname),
    QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, REMOTE_ADDR: "127.0.0.1",
    CONTENT_TYPE: h["content-type"] ?? "", GIT_PROTOCOL: h["git-protocol"] ?? "",
    HTTP_CONTENT_ENCODING: h["content-encoding"] ?? "",
    ...(h["content-length"] ? { CONTENT_LENGTH: h["content-length"] } : {}) } });
  req.pipe(cgi.stdin);
  let head = Buffer.alloc(0);
  let body = false;
  cgi.stdout.on("data", (d) => {
    if (body) return void res.write(d);
    head = Buffer.concat([head, d]);
    const crlf = head.indexOf("\\r\\n\\r\\n");
    const lf = head.indexOf("\\n\\n");
    const at = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
    if (at < 0) return;
    for (const line of head.subarray(0, at).toString().split(/\\r?\\n/)) {
      const i = line.indexOf(":");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k.toLowerCase() === "status") res.statusCode = parseInt(v, 10);
      else res.setHeader(k, v);
    }
    body = true;
    res.write(head.subarray(at + (at === crlf ? 4 : 2)));
  });
  cgi.stdout.on("end", () => res.end());
  cgi.on("error", () => { res.statusCode = 500; res.end(); });
}).listen(Number(port), "127.0.0.1");
`;

/** Rewrites the tool repository's plugins to `$2` from `$1`: manifests and the bundles' built-in version. */
const SET_VERSION = `set -eu
was=$(printf %s "$1" | sed 's/\\./\\\\./g')
grep -rlF "\\"$1\\"" plugins/*/.claude-plugin plugins/*/.codex-plugin plugins/*/dist |
  while read -r f; do sed -i "s/\\"$was\\"/\\"$2\\"/g" "$f"; done
`;

/** A scratch machine with `harnesses` on its PATH and the hub serving `BASE_VERSION`. */
export async function machine(
  harnesses: readonly HarnessCli[] = ["claude", "codex"],
): Promise<Machine> {
  const root = `${RUNS}/${randomBytes(4).toString("hex")}`;
  const home = `${root}/home`;
  const claudeConfig = `${home}/.claude`;
  const codexHome = `${root}/codex`;
  const hub = `${root}/hub`;
  const port = 20_000 + (randomBytes(2).readUInt16BE() % 30_000);
  const hubUrl = `http://127.0.0.1:${port}/hub/.git`;
  const tools = `${root}/tools`;
  const launcher = `${home}/.local/bin/squeal`;
  const env: Record<string, string> = {
    HOME: home,
    TMPDIR: `${root}/tmp`,
    CODEX_HOME: codexHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    XDG_RUNTIME_DIR: `${root}/run`,
    GIT_CONFIG_GLOBAL: `${home}/.gitconfig`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "real-cli",
    GIT_AUTHOR_EMAIL: "real-cli@invalid",
    GIT_COMMITTER_NAME: "real-cli",
    GIT_COMMITTER_EMAIL: "real-cli@invalid",
    DISABLE_AUTOUPDATER: "1",
    SQUEAL_MARKETPLACE: hubUrl,
    LANG: "C.UTF-8",
  };
  const path = [`${home}/.local/bin`, `${root}/bin`];
  const cwds = new Set<string>();
  let version = BASE_VERSION;

  const run: Machine["run"] = (cmd, args, options = {}) =>
    runIsolated({
      root,
      cmd,
      args,
      cwd: options.cwd ?? root,
      env: { ...env, ...options.env },
      path,
      ...(options.preserve === undefined ? {} : { preserve: options.preserve }),
      ...(options.input === undefined ? {} : { input: options.input }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  const sh: Machine["sh"] = (script, args = [], options = {}) =>
    run("/bin/sh", ["-c", script, "sh", ...args], options);

  const pin = (name: string, sha: string) =>
    `${JSON.stringify(
      {
        name: "hearsay",
        owner: { name: "real-cli" },
        plugins: [
          {
            name: "squeal",
            description: `squeal from ${CANDIDATE.slice(0, 12)}`,
            source: {
              source: "git-subdir",
              url: `file://${tools}`,
              path: `plugins/${name}`,
              ref: sha,
              sha,
            },
          },
        ],
      },
      null,
      2,
    )}\n`;

  const m: Machine = {
    root,
    home,
    claudeConfig,
    codexHome,
    hub: hubUrl,
    launcher,
    env,
    run,
    sh,
    async read(file) {
      const r = await sh('[ -e "$1" ] || exit 3; cat "$1"', [file]);
      if (r.status === 3) return null;
      return ok(r, `read ${file}`).stdout;
    },
    async publish(next) {
      ok(await sh(SET_VERSION, [version, next], { cwd: tools }), `set version ${next}`);
      version = next;
      ok(
        await sh('git add -A && git commit -q --allow-empty -m "squeal $1"', [next], {
          cwd: tools,
        }),
        "commit the tool repository",
      );
      const sha = (await sh("git rev-parse HEAD", [], { cwd: tools })).stdout.trim();
      ok(
        await sh(
          `mkdir -p .claude-plugin .agents/plugins
cat > .claude-plugin/marketplace.json <<'JSON'
${pin("claude-code", sha)}JSON
cat > .agents/plugins/marketplace.json <<'JSON'
${pin("codex", sha)}JSON
git add -A && git commit -q -m "pin squeal $1"`,
          [next],
          { cwd: hub },
        ),
        "pin the hub",
      );
    },
    install: (...args) =>
      run("/bin/sh", args.length === 0 ? [] : ["-s", "--", ...args], {
        input: show("install.sh"),
        cwd: home,
        timeoutMs: 300_000,
      }),
    squeal(args, cwd, options = {}) {
      cwds.add(cwd);
      return run("squeal", args, { timeoutMs: 300_000, ...options, cwd });
    },
    async dispose() {
      for (const cwd of cwds) await run("squeal", ["stop"], { cwd, timeoutMs: 60_000 });
      // Whatever still names the case: a daemon a session or a hook left. Never this script.
      await run("node", [
        "-e",
        `const fs = require("node:fs");
for (const pid of fs.readdirSync("/proc").filter((p) => /^\\d+$/.test(p))) {
  if (+pid === process.pid || +pid === process.ppid) continue;
  try { if (fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").includes(process.argv[1])) process.kill(+pid, "SIGKILL"); } catch {}
}`,
        root,
      ]);
      if (process.env.SQ_REAL_CLI_KEEP === undefined)
        await sh('cd / && rm -rf "$1"', [root], { timeoutMs: 120_000 });
    },
  };

  ok(await sh(BOOTSTRAP, [root, ...harnesses]), "bootstrap the case");
  const archive = execFileSync("git", ["archive", "--format=tar", CANDIDATE, "plugins"], {
    cwd: REPO_ROOT,
    maxBuffer: 1 << 28,
  });
  ok(await run("tar", ["-x", "-C", `${root}/src`], { input: archive }), "take the candidate in");
  ok(
    await sh(
      "git init -q tools && cp -R src/plugins tools/ && git -C tools add -A && git -C tools commit -q -m base && git init -q hub",
    ),
    "build the tool repository",
  );
  ok(
    await sh('nohup node -e "$1" "$2" "$3" >/dev/null 2>&1 &', [HUB_SERVER, root, String(port)]),
    "start the hub's server",
  );
  await m.publish(BASE_VERSION);
  for (let tries = 0; ; tries++) {
    const r = await run("git", ["ls-remote", hubUrl], { timeoutMs: 10_000 });
    if (r.status === 0) break;
    if (tries === 20) ok(r, `reach the hub at ${hubUrl}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return m;
}
