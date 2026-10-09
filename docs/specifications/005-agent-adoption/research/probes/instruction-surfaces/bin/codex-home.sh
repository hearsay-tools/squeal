#!/usr/bin/env bash
# Throwaway: scratch CODEX_HOME with the host's provider block (URL redacted, no credential;
# env_key names a variable), then the pinned Codex plugin installed and trusted.
# The pin's marketplace is renamed `hearsay` so the plugin id is the hub's
# `squeal@hearsay`, which `squeal init --harness codex --trust` looks for.
set -e; source "$(dirname "$0")/env.sh"
mkdir -p $R/codex $R/home
cat > $R/codex/config.toml <<'TOML'
model_provider = "cliproxy"
model = "gpt-6.1-sol"
approval_policy = "never"
sandbox_mode = "danger-full-access"
check_for_update_on_startup = false

[model_providers.cliproxy]
name = "CLI Proxy"
base_url = "<the host provider base_url; redacted from the committed copy>"
env_key = "CLIPROXY_API_KEY"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = true
TOML
sed -i '0,/"name": "squeal"/s//"name": "hearsay"/' $PIN/.agents/plugins/marketplace.json
export CODEX_HOME=$R/codex HOME=$R/home
codex plugin marketplace add $PIN
codex plugin add squeal@hearsay
# Trust needs a git worktree as cwd; any fixture does (bin/mkfix.sh).
cd "${1:?a fixture directory}" && node --disable-warning=ExperimentalWarning $PIN/plugins/codex/dist/cli/squeal.mjs init --harness codex --trust --yes
