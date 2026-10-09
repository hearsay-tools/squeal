import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initCodex } from "../../src/cli/codex/init.js";
import { type CliIo, main } from "../../src/cli/main.js";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { runtimeDir } from "../harness/bundle-helpers.js";
import { fakeRepo } from "../status/helpers.js";

/* Row 002-17: `squeal init --harness codex --trust` has Codex trust Squeal's hooks (spec 002 D1). */

/**
 * A `codex` that answers `app-server` the way Codex 0.160.1 does
 * (`research/wave-0-checks.md` 3): `hooks/list` lists three Squeal hooks (one trusted, one
 * untrusted, one modified) and one of another plugin; `config/batchWrite` trusts the keys it
 * is given. `STUB_MODE` bends it (`previous` adds two hooks of the previous id
 * `squeal@squeal`, one trusted; `previous-only` lists only those); every message it reads goes to `STUB_LOG`.
 */
const STUB = `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const mode = process.env.STUB_MODE ?? "ok";
const log = (entry) => appendFileSync(process.env.STUB_LOG, JSON.stringify(entry) + "\\n");
log({ pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2) });
if (mode === "crash") { process.stderr.write("boom: no config\\n"); process.exit(3); }
const hook = (key, eventName, pluginId, trustStatus) => ({ key, eventName, handlerType: "command",
  command: "node /cache/dist/" + eventName + ".mjs", pluginId, source: "plugin", enabled: true,
  currentHash: "sha256:" + key.length + eventName, trustStatus });
const previous = [hook("squeal@squeal:hooks/hooks.json:session_start:0:0", "sessionStart", "squeal@squeal", "trusted"),
  hook("squeal@squeal:hooks/hooks.json:stop:0:0", "stop", "squeal@squeal", "untrusted")];
const hooks = mode === "missing" ? [hook("other@x:hooks/hooks.json:stop:0:0", "stop", "other@x", "untrusted")]
  : mode === "previous-only" ? [...previous]
  : [hook("squeal@hearsay:hooks/hooks.json:session_start:0:0", "sessionStart", "squeal@hearsay", mode === "trusted" ? "trusted" : "untrusted"),
     hook("squeal@hearsay:hooks/hooks.json:stop:0:0", "stop", "squeal@hearsay", "trusted"),
     hook("squeal@hearsay:hooks/hooks.json:pre_tool_use:0:0", "preToolUse", "squeal@hearsay", mode === "trusted" ? "trusted" : "modified"),
     hook("other@x:hooks/hooks.json:stop:0:0", "stop", "other@x", "untrusted"),
     ...(mode === "previous" ? previous : [])];
const answer = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    log(m);
    if (mode === "silent" || m.id === undefined) continue;
    if (m.method === "initialize") answer(m.id, { userAgent: "stub", codexHome: process.env.CODEX_HOME });
    if (m.method === "hooks/list") answer(m.id, { data: m.params.cwds.map((cwd) => ({ cwd, hooks })) });
    if (m.method === "config/batchWrite") {
      for (const e of m.params.edits) for (const h of hooks)
        if (e.keyPath === 'hooks.state."' + h.key + '".trusted_hash' && e.value === h.currentHash) h.trustStatus = "trusted";
      answer(m.id, { status: "ok", version: "sha256:v", filePath: process.env.CODEX_HOME + "/config.toml" });
    }
  }
});
`;

interface Stub {
  readonly env: Record<string, string>;
  /** Every line the stub logged: its start record, then each message it read. */
  readonly log: () => Record<string, unknown>[];
}

function stub(mode = "ok"): Stub {
  const dir = runtimeDir();
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "codex"), STUB);
  chmodSync(join(dir, "bin", "codex"), 0o755);
  const logPath = join(dir, "log.jsonl");
  writeFileSync(logPath, "");
  return {
    env: {
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      CODEX_HOME: join(dir, "codex-home"),
      STUB_MODE: mode,
      STUB_LOG: logPath,
    },
    log: () =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

function capture(cwd: string, env: Record<string, string>) {
  const out = { stdout: "", stderr: "" };
  const io: CliIo = {
    stdout: (t) => {
      out.stdout += t;
    },
    stderr: (t) => {
      out.stderr += t;
    },
    cwd,
    env,
  };
  return { io, out };
}

type Ask = ((question: string) => Promise<string>) | null;

async function trust(s: Stub, ask: Ask, yes = false, timeoutMs?: number) {
  const repo = fakeRepo();
  const { io, out } = capture(repo.main, s.env);
  const questions: string[] = [];
  const asking =
    ask === null
      ? null
      : (q: string) => {
          questions.push(q);
          return ask(q);
        };
  const code = await initCodex(
    io,
    { trust: true, yes },
    { ask: asking, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
  );
  return { code, ...out, questions, root: repo.main };
}

const methods = (s: Stub) =>
  s.log().flatMap((m) => (typeof m.method === "string" ? [m.method] : []));
const edits = (s: Stub) =>
  s.log().find((m) => m.method === "config/batchWrite")?.params as { edits: unknown[] } | undefined;

/** The stub's pid, and that it is gone: the app-server is killed on every path. */
function expectStubGone(s: Stub, root?: string) {
  const [start] = s.log();
  expect(start?.argv).toEqual(["app-server"]);
  if (root !== undefined) expect(start?.cwd).toBe(root);
  expect(() => process.kill(start?.pid as number, 0)).toThrow();
}

describe("squeal init --harness codex --trust", () => {
  it("shows the untrusted and modified Squeal hooks, asks, and on yes has Codex trust exactly those", async () => {
    const s = stub();
    const r = await trust(s, async () => "y\n");
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
    expect(r.stdout).toContain("Codex has not trusted 2 hooks of squeal@hearsay");
    expect(r.stdout).toMatch(/SessionStart\s+untrusted/);
    expect(r.stdout).toMatch(/PreToolUse\s+modified/);
    expect(r.stdout).toContain("node /cache/dist/preToolUse.mjs");
    expect(r.questions).toEqual(["Have Codex trust these 2 hooks? [y/N] "]);
    expect(methods(s)).toEqual([
      "initialize",
      "initialized",
      "hooks/list",
      "config/batchWrite",
      "hooks/list",
    ]);
    expect(s.log()[3]?.params).toEqual({ cwds: [r.root] });
    expect(edits(s)).toEqual({
      edits: [
        {
          keyPath: 'hooks.state."squeal@hearsay:hooks/hooks.json:session_start:0:0".trusted_hash',
          value: "sha256:49sessionStart",
          mergeStrategy: "replace",
        },
        {
          keyPath: 'hooks.state."squeal@hearsay:hooks/hooks.json:pre_tool_use:0:0".trusted_hash',
          value: "sha256:48preToolUse",
          mergeStrategy: "replace",
        },
      ],
      reloadUserConfig: true,
    });
    expect(r.stdout).toMatch(/SessionStart\s+trusted/);
    expect(r.stdout).toMatch(/PreToolUse\s+trusted/);
    expect(r.stdout).not.toContain("other@x");
    expect(r.stdout).not.toContain("squeal@squeal");
    expectStubGone(s, r.root);
  });

  it("says when Codex still has the previous squeal@squeal, and trusts only squeal@hearsay", async () => {
    const s = stub("previous");
    const r = await trust(s, async () => "y\n");
    expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: "" });
    expect(r.stdout).toContain(
      [
        "squeal init: Codex still has the previous squeal@squeal, 1 of its 2 hooks trusted; with no Codex session running, remove it:",
        "  codex plugin remove squeal@squeal",
        "  codex plugin marketplace remove squeal",
        "",
      ].join("\n"),
    );
    expect(edits(s)?.edits.map((e) => (e as { keyPath: string }).keyPath)).toEqual([
      'hooks.state."squeal@hearsay:hooks/hooks.json:session_start:0:0".trusted_hash',
      'hooks.state."squeal@hearsay:hooks/hooks.json:pre_tool_use:0:0".trusted_hash',
    ]);
    expectStubGone(s);
  });

  it("names the previous id and the install commands when only squeal@squeal is installed", async () => {
    const s = stub("previous-only");
    const r = await trust(s, async () => "y\n");
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      "Codex still has the previous squeal@squeal, 1 of its 2 hooks trusted",
    );
    expect(r.stderr).toContain("Codex lists no hooks of squeal@hearsay; install the plugin first:");
    expect(r.stderr).toContain("codex plugin add squeal@hearsay\n");
    expect(methods(s)).not.toContain("config/batchWrite");
    expectStubGone(s);
  });

  it("changes nothing when the answer is no, or empty (the default)", async () => {
    for (const answer of ["n\n", "\n", ""]) {
      const s = stub();
      const r = await trust(s, async () => answer);
      expect(r.code, JSON.stringify(answer)).toBe(1);
      expect(r.stderr).toContain("nothing changed");
      expect(methods(s)).not.toContain("config/batchWrite");
      expectStubGone(s);
    }
  });

  it("with --yes trusts without asking, through main", async () => {
    const s = stub();
    const repo = fakeRepo();
    const { io, out } = capture(repo.main, s.env);
    const code = await main(["init", "--harness", "codex", "--trust", "--yes"], io);
    expect({ code, stderr: out.stderr }).toEqual({ code: 0, stderr: "" });
    expect(out.stdout).toContain("wrote squeal.config.json");
    expect(out.stdout).toMatch(/SessionStart\s+trusted/);
    expect(edits(s)?.edits).toHaveLength(2);
    expectStubGone(s, repo.main);
  });

  it("with no terminal and no --yes prints the hooks and exits 1, changing nothing", async () => {
    const s = stub();
    const r = await trust(s, null);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/SessionStart\s+untrusted/);
    expect(r.stderr).toContain("--yes");
    expect(methods(s)).not.toContain("config/batchWrite");
    expectStubGone(s);
  });

  it("says so and asks nothing when every Squeal hook is trusted", async () => {
    const s = stub("trusted");
    const r = await trust(s, async () => "y\n");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("every hook of squeal@hearsay is trusted");
    expect(r.questions).toEqual([]);
    expect(methods(s)).not.toContain("config/batchWrite");
    expectStubGone(s);
  });

  it("names the two install commands when the plugin is not installed", async () => {
    const s = stub("missing");
    const r = await trust(s, async () => "y\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("codex plugin marketplace add hearsay-tools/marketplace\n");
    expect(r.stderr).toContain("codex plugin add squeal@hearsay\n");
    expect(methods(s)).not.toContain("config/batchWrite");
    expectStubGone(s);
  });

  it("says in one line that codex is not on PATH", async () => {
    const s = stub();
    const r = await trust({ ...s, env: { ...s.env, PATH: runtimeDir() } }, async () => "y\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^squeal init: codex is not on PATH[^\n]*\n$/);
  });

  it("gives up in one line on an app-server that stays silent, and kills it", async () => {
    const s = stub("silent");
    const r = await trust(s, async () => "y\n", false, 300);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^squeal init: codex app-server did not answer initialize[^\n]*\n$/);
    expectStubGone(s);
  });

  it("gives up in one line on an app-server that exits, with its last stderr line", async () => {
    const s = stub("crash");
    const r = await trust(s, async () => "y\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^squeal init: codex app-server exited[^\n]*boom: no config\n$/);
  });

  it("rejects --trust and --yes where they mean nothing", () => {
    const repo = fakeRepo();
    for (const args of [
      ["--trust"],
      ["--harness", "codex", "--yes"],
      ["--harness", "codex", "--trust", "--print-launcher-config"],
    ]) {
      const { io, out } = capture(repo.main, {});
      expect(main(["init", ...args], io), args.join(" ")).toBe(2);
      expect(out.stderr).toMatch(/^squeal init: takes no arguments but those below; /);
    }
    expect(existsSync(join(repo.main, "squeal.config.json"))).toBe(false);
  });
});

/** Codex 0.160.1 itself, in a scratch HOME and CODEX_HOME; skipped where `codex` is absent. */
const codexOnPath = spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0;

/** Every file under `dir`, relative, with its content. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path.slice(dir.length)] = readFileSync(path, "utf8");
  }
  return files;
}

describe.skipIf(!codexOnPath)("squeal init --harness codex --trust --yes against Codex", () => {
  it("installs the plugin from this checkout under the hub's name, trusts every Squeal hook, and only Codex writes", async () => {
    const scratch = runtimeDir();
    const home = join(scratch, "home");
    const codexHome = join(scratch, "codex-home");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(codexHome);
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "untouched"\n');
    const homeBefore = snapshot(home);
    const env = { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: codexHome };
    const codex = (...args: string[]) => {
      const r = spawnSync("codex", args, { env, encoding: "utf8", timeout: 60_000 });
      expect(r.status, `codex ${args.join(" ")}: ${r.stderr}`).toBe(0);
    };
    // The hub's name over this checkout's Codex plugin, so the id is the released one.
    const hub = join(scratch, "hub");
    mkdirSync(join(hub, ".agents", "plugins"), { recursive: true });
    cpSync(join(REPO_ROOT, "plugins", "codex"), join(hub, "plugins", "codex"), { recursive: true });
    writeFileSync(
      join(hub, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({ name: "hearsay", plugins: [{ name: "squeal", source: "./plugins/codex" }] }),
    );
    codex("plugin", "marketplace", "add", hub);
    codex("plugin", "add", "squeal@hearsay");
    const configBefore = readFileSync(join(codexHome, "config.toml"), "utf8");

    const repo = fakeRepo();
    const { io, out } = capture(repo.main, env);
    const code = await main(["init", "--harness", "codex", "--trust", "--yes"], io);
    expect({ code, stderr: out.stderr }).toEqual({ code: 0, stderr: "" });
    const events = [...out.stdout.matchAll(/^ {2}(\w+)\s+trusted$/gm)].map((m) => m[1]);
    expect(events).toHaveLength(9);

    // Codex appended the hooks.state tables; nothing else in its config moved.
    const configAfter = readFileSync(join(codexHome, "config.toml"), "utf8");
    const added = configAfter.replace(configBefore, "");
    expect(configAfter.startsWith(configBefore)).toBe(true);
    expect(
      added.match(/^\[hooks\.state\."squeal@hearsay:hooks\/hooks\.json:[a-z_]+:\d+:\d+"\]$/gm),
    ).toHaveLength(9);
    expect(
      added.replace(/^(\[hooks\.state\.[^\n]+\]|trusted_hash = "sha256:[0-9a-f]{64}"|)$/gm, ""),
    ).toMatch(/^\s*$/);
    expect(snapshot(home)).toEqual(homeBefore);

    // A fresh app-server reads the trust back from Codex's own config.
    const again = capture(repo.main, env);
    expect(await main(["init", "--harness", "codex", "--trust"], again.io)).toBe(0);
    expect(again.out.stdout).toContain("every hook of squeal@hearsay is trusted");

    // No bypass flag anywhere in the command's source.
    const bypass = ["--dangerously", "bypass", "hook", "trust"].join("-");
    for (const file of ["src/cli/codex/trust.ts", "src/cli/codex/init.ts", "src/cli/init.ts"]) {
      expect(readFileSync(join(REPO_ROOT, file), "utf8"), file).not.toContain(bypass);
    }
  }, 120_000);
});
