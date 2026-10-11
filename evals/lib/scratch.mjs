// A cell's scratch homes (spec 006 D3): the subject harness never reads or writes the real
// ~/.claude or ~/.codex, and the host's model provider is read at run time, never written into
// this public repository.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|AUTH/i;
const NOT_SECRET = /(?:PATH|FILE|DIR|HOME|SOCK)$/;

/**
 * The cell's environment: the parent session's `CLAUDE*`, `CEZ_*` and Codex thread variables
 * removed, and every key, token or provider variable except `provider`, the names the subject
 * harness authenticates with (`providerVariables`). No other credential reaches a subject.
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
    CODEX_HOME: join(cell, "codex"),
    DISABLE_AUTOUPDATER: "1",
    GIT_AUTHOR_NAME: "ledgerline",
    GIT_AUTHOR_EMAIL: "dev@ledgerline.invalid",
    GIT_COMMITTER_NAME: "ledgerline",
    GIT_COMMITTER_EMAIL: "dev@ledgerline.invalid",
  });
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
 * The scratch Codex `config.toml` for `model`: the real config's `model_provider` and its
 * `[model_providers.<name>]` block copied as they are (the block names its key through
 * `env_key`, so no key is written), approvals off and full access.
 */
export function codexConfig(realConfig, model) {
  const { provider, block } = providerBlock(realConfig);
  return [
    `model_provider = "${provider}"`,
    `model = "${model}"`,
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "check_for_update_on_startup = false",
    "",
    block.trim(),
    "",
  ].join("\n");
}

function providerBlock(config) {
  const provider = /^model_provider\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!provider) throw new Error("the Codex config names no model_provider");
  const header = `[model_providers.${provider}]`;
  const at = config.indexOf(header);
  if (at < 0) throw new Error(`the Codex config has no ${header} block`);
  const rest = config.slice(at + header.length);
  const end = rest.search(/^\[/m);
  return { provider, block: header + (end < 0 ? rest : rest.slice(0, end)) };
}

/**
 * The values no file outside /tmp may hold: the environment's keys, tokens and secrets, the
 * base URLs of the providers (environment and real Codex config) and their hosts. Short values
 * are left out, since they match by accident.
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
  for (const s of [...secrets]) {
    if (!/^https?:\/\//.test(s)) continue;
    const host = new URL(s).host;
    if (!/^(?:localhost|127\.|\[::1\])|^api\.(?:anthropic|openai)\.com$/.test(host))
      secrets.add(host);
  }
  return [...secrets];
}

/** Files under `dirs` holding any of `secrets`: the path and how many secrets it holds, never the values. */
export function scanForSecrets(dirs, secrets) {
  const hits = [];
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      if (/\/node_modules$|\/\.git\/objects$/.test(p)) return;
      for (const e of readdirSync(p)) visit(join(p, e));
    } else if (st.isFile() && st.size < 64 * 1024 * 1024) {
      const text = readFileSync(p, "latin1");
      const n = secrets.filter((s) => text.includes(s)).length;
      if (n) hits.push({ path: p, secrets: n });
    }
  };
  for (const d of dirs) if (existsSync(d)) visit(d);
  return hits;
}

/**
 * Scans the cell for `secrets`, removes its scratch homes, temp directory and the work tree's
 * `node_modules`, then scans again. The scratch Codex config holds the provider's URL by design
 * and is removed with the rest; nothing else may hold a secret. Returns relative paths only.
 */
export function clearScratch(cell, secrets) {
  const scratchDirs = ["home", "codex", "tmp", "out", "work"].map((d) => join(cell, d));
  const before = scanForSecrets(scratchDirs, secrets)
    .map((h) => relative(cell, h.path))
    .filter((p) => p !== "codex/config.toml");
  for (const d of ["home", "codex", "tmp", "work/node_modules"])
    rmSync(join(cell, d), { recursive: true, force: true });
  const after = scanForSecrets([cell], secrets).map((h) => relative(cell, h.path));
  return { secretsBeforeRemoval: before, secretsAfterRemoval: after };
}
