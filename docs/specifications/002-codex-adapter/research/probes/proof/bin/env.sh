# Throwaway: sourced by every proof probe. Scratch Codex home and HOME under
# /tmp/p16; the provider reads its key from the environment, so no credential
# is copied. ~/.codex is never read beyond its provider block, never written.
P=/tmp/p16
export CODEX_HOME=$P/codex HOME=$P/home
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p
# The agent's `squeal`: the CLI of the plugin Codex installed (D1: bin/ is not on PATH).
export PATH=$P/bin:$PATH
PROOF_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
