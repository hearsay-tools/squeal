// A cell's scratch homes (spec 006 D3): the subject harness never reads or writes the real
// ~/.claude or ~/.codex, and the host's model provider is read at run time, never written into
// this public repository.
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|AUTH/i;
const NOT_SECRET = /(?:PATH|FILE|DIR|HOME|SOCK)$/;

/**
 * The cell's environment: the parent session's `CLAUDE*`, `CEZ_*` and Codex thread variables
 * removed, and every key, token or provider variable except `provider`, the names the subject
 * harness authenticates with (`providerVariables`). No other credential reaches a subject.
 *
 * Its own `XDG_RUNTIME_DIR`, `<cell>/run` (row 006-56): a daemon's slow slot and capacity pool
 * live in `<runtime dir>/squeal` (spec 004 D2 as amended, 004-16), so a cell's daemon shares
 * neither with the host's other daemons. Its socket does not fit under a cell's path (spec 001
 * D1's 103 bytes), so it falls back to `/tmp/squeal-<uid>`, named by the cell's worktree.
 *
 * Its own XDG base directories, the defaults under its scratch `HOME` (review 006-63 B1): the
 * terminal launcher (spec 005 D3, format 4) picks the newest Squeal across harnesses, Pi's and
 * OpenCode's packages under `XDG_DATA_HOME` among them, and Squeal reads its user config from
 * `XDG_CONFIG_HOME` (spec 001 D11), so a host's would reach the cell's pinned Squeal.
 */
export function cellEnv(parent, cell, provider = []) {
  const env = {};
  for (const [k, v] of Object.entries(parent)) {
    if (/^(CLAUDE|CEZ_|CODEX_(SESSION|THREAD))/.test(k) || k === "SSH_AUTH_SOCK") continue;
    if ((SECRET_NAME.test(k) || /^(ANTHROPIC|OPENAI)_/.test(k)) && !provider.includes(k)) continue;
    env[k] = v;
  }
  return Object.assign(env, {
    HOME: join(cell, "home"),
    TMPDIR: join(cell, "tmp"),
    XDG_RUNTIME_DIR: join(cell, "run"),
    XDG_DATA_HOME: join(cell, "home/.local/share"),
    XDG_CONFIG_HOME: join(cell, "home/.config"),
    XDG_STATE_HOME: join(cell, "home/.local/state"),
    XDG_CACHE_HOME: join(cell, "home/.cache"),
    CODEX_HOME: join(cell, "codex"),
    DISABLE_AUTOUPDATER: "1",
    GIT_AUTHOR_NAME: "ledgerline",
    GIT_AUTHOR_EMAIL: "dev@ledgerline.invalid",
    GIT_COMMITTER_NAME: "ledgerline",
    GIT_COMMITTER_EMAIL: "dev@ledgerline.invalid",
  });
}

/**
 * The directory whose `squeal` a bare `squeal` in a cell runs (row 006-62): the pinned plugin's.
 * A cell inherits the host's `PATH`, whose `~/.local/bin/squeal` (spec 005 D3's launcher) reads
 * the plugin registry from the cell's empty `HOME`; Claude Code's `--plugin-dir` registers
 * nothing there, so it answered `no squeal@hearsay plugin is installed`. Claude Code: the
 * plugin's own `bin/` (spec 001 D9). Codex puts no plugin `bin/` on the `PATH`, so its `squeal`
 * is the pinned plugin's launcher where `install.sh` copies it, `<cell>/home/.local/bin`, which
 * finds the plugin in the cell's `CODEX_HOME`. Put first on the `PATH` with `pathFirst`.
 */
export function squealBin(harness, cell, pin) {
  if (harness !== "codex") return join(pin, "plugins/claude-code/bin");
  const dir = join(cell, "home/.local/bin");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(pin, "plugins/codex/bin/squeal-launcher"), join(dir, "squeal"));
  chmodSync(join(dir, "squeal"), 0o755);
  return dir;
}

/** `path` with `dir` first, and not again later. */
export function pathFirst(path, dir) {
  return [dir, ...(path ?? "").split(":").filter((p) => p && p !== dir)].join(":");
}

/**
 * The variables a harness authenticates with: Claude Code's `ANTHROPIC_*` from the environment,
 * Codex's provider key as its config's `env_key` names it.
 */
export function providerVariables(harness, parent, realCodexConfig = "") {
  if (harness === "claude") return Object.keys(parent).filter((k) => /^ANTHROPIC_/.test(k));
  const block = providerBlock(realCodexConfig).block;
  const key = /^\s*env_key\s*=\s*"([^"]+)"/m.exec(block)?.[1];
  return key ? [key] : [];
}

/**
 * The scratch Codex `config.toml` for `model`: the real config's `model_provider` and the
 * allow-listed fields of its `[model_providers.<name>]` block (the block names its key through
 * `env_key`, so no key is written), approvals off and full access. Any other field, a sub-table
 * or an inline table (`http_headers`, a bearer token) throws naming the field, never its value.
 */
export function codexConfig(realConfig, model) {
  const { provider, block } = providerBlock(realConfig);
  const lines = block.split("\n").slice(1);
  for (const sub of lines.filter((l) => /^\s*\[/.test(l)))
    throw new Error(`the Codex provider's ${sub.trim()} table is not copied into a cell`);
  const kept = [];
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const key = /^\s*([\w-]+)\s*=/.exec(line)?.[1];
    if (!key || !PROVIDER_FIELDS.has(key) || /=\s*[{[]/.test(line))
      throw new Error(
        `the Codex provider's field ${key ?? "(unparsed line)"} is not supported: not copied into a cell`,
      );
    kept.push(line.trim());
  }
  return [
    `model_provider = "${provider}"`,
    `model = "${model}"`,
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "check_for_update_on_startup = false",
    "",
    `[model_providers.${provider}]`,
    ...kept,
    "",
  ].join("\n");
}

/** The provider fields a cell's Codex config may carry: none holds a credential inline. */
const PROVIDER_FIELDS = new Set([
  "name",
  "base_url",
  "env_key",
  "env_key_instructions",
  "wire_api",
  "requires_openai_auth",
  "supports_websockets",
  "request_max_retries",
  "stream_max_retries",
  "stream_idle_timeout_ms",
]);

/** The block of the configured provider: its header line and everything up to the next table. */
function providerBlock(config) {
  const provider = /^model_provider\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!provider) throw new Error("the Codex config names no model_provider");
  const header = `[model_providers.${provider}]`;
  const at = config.indexOf(header);
  if (at < 0) throw new Error(`the Codex config has no ${header} block`);
  const rest = config.slice(at + header.length);
  // A sub-table of the provider (`[model_providers.<name>.http_headers]`) stays in the block.
  const sub = `[model_providers.${provider}.`;
  const end = [...rest.matchAll(/^\[.*$/gm)].find((m) => !m[0].startsWith(sub))?.index ?? -1;
  return { provider, block: header + (end < 0 ? rest : rest.slice(0, end)) };
}

/**
 * The values no file outside /tmp may hold: the environment's keys, tokens and secrets, the
 * base URLs of the providers (environment and real Codex config) and their hosts, and any
 * string a provider block holds outside its name, key variable and wire protocol (an inline
 * header or token). Short values are left out, since they match by accident.
 */
export function secretsOf(env, realCodexConfig = "") {
  const secrets = new Set();
  for (const [k, v] of Object.entries(env)) {
    if (!v || v.length < 12) continue;
    if (SECRET_NAME.test(k) && !NOT_SECRET.test(k)) {
      secrets.add(v);
      if (v.length >= 32) secrets.add(v.slice(-20)); // Claude Code keeps a key's last 20 characters
    }
    if (/BASE_URL|_ENDPOINT$/i.test(k)) secrets.add(v);
  }
  for (const m of realCodexConfig.matchAll(/base_url\s*=\s*"([^"]+)"/g)) secrets.add(m[1]);
  for (const v of providerStrings(realCodexConfig)) {
    secrets.add(v);
    for (const w of v.split(/\s+/)) if (w.length >= 12) secrets.add(w);
  }
  for (const s of [...secrets]) {
    if (!/^https?:\/\//.test(s)) continue;
    const host = new URL(s).host;
    if (!/^(?:localhost|127\.|\[::1\])|^api\.(?:anthropic|openai)\.com$/.test(host))
      secrets.add(host);
  }
  return [...secrets];
}

/** Quoted values of 12 or more characters in `[model_providers.*]` tables, except harmless keys. */
function providerStrings(config) {
  const out = [];
  let inProvider = false;
  for (const line of config.split("\n")) {
    const table = /^\s*\[([^\]]+)\]/.exec(line);
    if (table) {
      inProvider = table[1].startsWith("model_providers.");
      continue;
    }
    if (!inProvider || /^\s*(?:name|env_key|wire_api|env_key_instructions)\s*=/.test(line))
      continue;
    for (const m of line.matchAll(/"([^"]{12,})"/g)) out.push(m[1]);
  }
  return out;
}

/** `text` with every secret replaced by `[redacted]`, the longest first. */
export function redact(text, secrets) {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length))
    out = out.replaceAll(s, "[redacted]");
  return out;
}

const SCAN_LIMIT = 64 * 1024 * 1024;

/**
 * Files under `dirs` holding any of `secrets`: the path and how many secrets it holds, never the
 * values. The scan reads every file at any depth and never follows a link: a link's own bytes are
 * its target. A file too large to scan, or a directory it cannot read, is listed with
 * `unscanned: true`. In `retained` evidence (review wave 1.6, B1) every link and every other entry
 * that is neither a file nor a directory, a FIFO or a socket, is listed unscanned whatever it
 * names: the scan cannot vouch for what it reaches.
 */
export function scanForSecrets(dirs, secrets, { retained = false } = {}) {
  const hits = [];
  const holds = (text) => secrets.filter((s) => text.includes(s)).length;
  const visit = (p) => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      let entries;
      try {
        entries = readdirSync(p);
      } catch {
        hits.push({ path: p, secrets: 0, unscanned: true });
        return;
      }
      for (const e of entries) visit(join(p, e));
    } else if (retained && !st.isFile()) {
      hits.push({ path: p, secrets: 0, unscanned: true });
    } else if (st.isSymbolicLink()) {
      const n = holds(readlinkSync(p));
      if (n) hits.push({ path: p, secrets: n });
    } else if (st.isFile() && st.size >= SCAN_LIMIT) {
      hits.push({ path: p, secrets: 0, unscanned: true });
    } else if (st.isFile()) {
      let n;
      try {
        n = holds(readFileSync(p, "latin1"));
      } catch {
        hits.push({ path: p, secrets: 0, unscanned: true });
        return;
      }
      if (n) hits.push({ path: p, secrets: n });
    }
  };
  for (const d of dirs) if (existsSync(d)) visit(d);
  return hits;
}

/** The directories retained evidence never keeps: dependency trees and Git's compressed objects. */
const UNKEPT = /\/(?:node_modules|\.git\/objects)$/;

/**
 * Removes every unkept directory under `dir` and every entry that is neither a file nor a
 * directory (a link, FIFO or socket), at any depth, never following a link; one that resists is
 * listed unscanned by the scan.
 */
function prune(dir) {
  const visit = (p) => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return;
    }
    if (st.isDirectory() ? UNKEPT.test(p) : !st.isFile()) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        // Scanned below: whatever survives in it fails the cell.
      }
    } else if (st.isDirectory()) {
      let entries = [];
      try {
        entries = readdirSync(p);
      } catch {
        // Listed by the scan as unscanned.
      }
      for (const e of entries) visit(join(p, e));
    }
  };
  visit(dir);
}

/**
 * Clears a cell's scratch and makes its retained evidence safe: scans the cell for `secrets`,
 * removes the scratch homes, temp and runtime directories and the work tree's `.git` (the diff
 * and the store copy were taken from it), then removes from `out/` and `work/` every `node_modules` and
 * `.git/objects` at any depth and every link, FIFO and socket, sanitizes each text file that holds a secret and
 * removes each binary or unscannable one, and scans the whole cell again with nothing skipped.
 * The scratch Codex config holds the provider's URL by design and is removed with the rest.
 * Returns relative paths only: `secretsAfterRemoval` not empty means a secret survived, or
 * something retained could not be scanned, and the cell fails.
 */
export function clearScratch(cell, secrets) {
  const rel = (h) => relative(cell, h.path);
  const evidence = ["out", "work"].map((d) => join(cell, d));
  const before = scanForSecrets(
    ["home", "codex", "tmp", "run", "out", "work"].map((d) => join(cell, d)),
    secrets,
  )
    .map(rel)
    .filter((p) => p !== "codex/config.toml");
  for (const d of ["home", "codex", "tmp", "run", "work/.git"])
    try {
      rmSync(join(cell, d), { recursive: true, force: true });
    } catch {
      // Scanned below.
    }
  for (const d of evidence) prune(d);
  const sanitized = [];
  const removed = [];
  for (const hit of scanForSecrets(evidence, secrets, { retained: true })) {
    try {
      const bytes = hit.unscanned ? null : readFileSync(hit.path);
      const text = bytes?.toString("utf8");
      if (text !== undefined && !text.includes("\0") && Buffer.from(text).equals(bytes)) {
        // A new file, so a hard link's other name keeps its bytes.
        rmSync(hit.path);
        writeFileSync(hit.path, redact(text, secrets));
        sanitized.push(rel(hit));
      } else {
        rmSync(hit.path, { recursive: true, force: true });
        removed.push(rel(hit));
      }
    } catch {
      // Left for the scan below to report.
    }
  }
  const after = scanForSecrets([cell], secrets, { retained: true }).map(rel);
  return { secretsBeforeRemoval: before, sanitized, removed, secretsAfterRemoval: after };
}

/**
 * Copies what outlives the scratch into the cell's `out/`: Squeal's store (`out/store/`) and the
 * harness's own records (`out/harness/`, Claude Code's projects or Codex's sessions). Both are
 * retained evidence, scanned by `clearScratch` like the rest of `out/`.
 */
export function keepRecords(cell, harness) {
  const store = join(cell, "work/.git/squeal");
  if (existsSync(store)) {
    mkdirSync(join(cell, "out/store"), { recursive: true });
    for (const f of readdirSync(store))
      if (/^store\.sqlite/.test(f)) cpSync(join(store, f), join(cell, "out/store", f));
  }
  const records = join(cell, harness === "claude" ? "home/.claude/projects" : "codex/sessions");
  if (existsSync(records)) cpSync(records, join(cell, "out/harness"), { recursive: true });
}
