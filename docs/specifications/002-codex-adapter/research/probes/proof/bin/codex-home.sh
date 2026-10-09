#!/usr/bin/env bash
# Throwaway: write the scratch CODEX_HOME's config.toml, the host's provider
# block with no credential (env_key names a variable, never a value) and its
# base_url redacted.
set -e; P=/tmp/p16; mkdir -p $P/codex $P/home $P/bin
cat > $P/codex/config.toml <<'TOML'
model_provider = "cliproxy"
model = "gpt-6.1-sol"
model_context_window = 272000
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
