# Throwaway probe for 011-127: the scratch environment every daemon command runs in. Source it.
export R=/tmp/r127 C=/tmp/r127/repo
export HOME=$R/home XDG_RUNTIME_DIR=$R/run XDG_CONFIG_HOME=$R/config TMPDIR=$R/tmp R127_LOG=$R/daemon-builders.jsonl
unset SQUEAL_OBSERVE CLAUDE_SESSION_ID CODEX_SESSION_ID
sq() { (cd $C && node $C/plugins/claude-code/dist/cli/squeal.mjs "$@"); }
