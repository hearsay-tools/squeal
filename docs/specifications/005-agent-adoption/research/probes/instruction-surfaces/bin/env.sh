# Throwaway: sourced by every instruction-surfaces probe. All scratch under /tmp/r52.
# Codex gets a scratch CODEX_HOME and HOME; the provider reads its key from the
# environment, so no credential is copied. ~/.codex is never written.
R=/tmp/r52
PIN=$R/pin                                   # git archive of this commit's plugins
SQ="node --disable-warning=ExperimentalWarning $PIN/plugins/claude-code/dist/cli/squeal.mjs"
PROBES="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p
export DISABLE_AUTOUPDATER=1
# Drop the parent session's Claude Code and Cezar variables (001 lessons, Setup).
for v in $(env | cut -d= -f1 | grep -E '^(CLAUDE|CEZ_)'); do unset "$v"; done
