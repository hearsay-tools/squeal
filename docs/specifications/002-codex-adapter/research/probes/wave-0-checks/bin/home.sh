#!/usr/bin/env bash
# Throwaway: create a scratch CODEX_HOME at /tmp/w0c/home-<name> holding only the provider and
# model settings of ~/.codex/config.toml (lines before the first plugin/project table; no credential:
# the provider reads its key from an environment variable). ~/.codex/auth.json is never touched.
set -e
h="/tmp/w0c/home-$1"; rm -rf "$h"; mkdir -p "$h"
awk '/^\[(marketplaces|plugins|projects|notice)/{exit} {print}' "$HOME/.codex/config.toml" > "$h/config.toml"
echo "$h"
