#!/usr/bin/env bash
# Throwaway Q1: how `codex plugin marketplace add` and `codex plugin add` treat three marketplace
# layouts (see mkrepo.sh). Each layout gets its own scratch CODEX_HOME. Output with $CODEX_HOME
# abbreviated.
B="$(cd "$(dirname "$0")" && pwd)"
for layout in one dup split; do
  echo "################ layout: $layout"
  export CODEX_HOME=$(bash "$B/home.sh" q1-$layout)
  R=$(bash "$B/mkrepo.sh" q1-$layout $layout)
  ab() { sed "s#$CODEX_HOME#\$CODEX_HOME#g"; }
  echo "\$ codex plugin marketplace add $R"; codex plugin marketplace add "$R" 2>&1 | ab
  echo "\$ codex plugin list"; codex plugin list 2>&1 | ab
  for p in squeal squeal-codex; do echo "\$ codex plugin add $p@squeal"; codex plugin add $p@squeal 2>&1 | ab; echo "exit $?"; done
  echo "\$ cat \$CODEX_HOME/plugins/cache/squeal/*/*/.*-plugin/plugin.json"
  for f in "$CODEX_HOME"/plugins/cache/squeal/*/*/.*-plugin/plugin.json; do echo "${f#$CODEX_HOME/}: $(tr -d '\n' < "$f")"; done
  echo "\$ config.toml after"; sed -n '/^\[marketplaces/,$p' "$CODEX_HOME/config.toml"
done
