#!/usr/bin/env bash
# Throwaway: run "$@" with the outer session's CLAUDE*/CEZ*/CODEX_THREAD* variables unset (as from a plain terminal).
args=()
for k in $(env | cut -d= -f1 | grep -E '^(CLAUDE|CEZ_|CODEX_THREAD|CODEX_CI)'); do args+=(-u "$k"); done
exec env "${args[@]}" "$@"
