# Throwaway (005-04). Sourced by every probe script: a scratch HOME, CLAUDE_CONFIG_DIR and
# CODEX_HOME under $W, the parent session's CLAUDE*, CEZ_* and unrelated credentials removed.
# The harness credential variables stay in the environment and are never written to a file.
W=${W:-/tmp/wave0-checks}
for v in $(env | cut -d= -f1 | grep -E '^(CLAUDE|CEZ_|CODEX_(SESSION|THREAD)|GH_TOKEN$|AGENT_VAULT|OPENCLAW_|SSH_AUTH_SOCK$)'); do unset "$v"; done
export HOME=$W/home CLAUDE_CONFIG_DIR=$W/home/.claude CODEX_HOME=$W/codex TMPDIR=$W/tmp
for v in $(env | cut -d= -f1 | grep "^XDG_"); do unset "$v"; done
export XDG_RUNTIME_DIR=$W/run
# the parent session's PATH carries the real ~/.claude plugin bin: drop every entry under a real home config dir
PATH=$(printf %s "$PATH" | tr : "\n" | grep -vE "/home/[^/]+/\.(claude|codex)/" | paste -sd: -); export PATH
export DISABLE_AUTOUPDATER=1 GIT_CONFIG_GLOBAL=$W/home/.gitconfig
export GIT_AUTHOR_NAME=probe GIT_AUTHOR_EMAIL=probe@invalid GIT_COMMITTER_NAME=probe GIT_COMMITTER_EMAIL=probe@invalid
mkdir -p "$W/run" && chmod 700 "$W/run"; mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" "$TMPDIR"
load() { cut -d' ' -f1 /proc/loadavg; }
