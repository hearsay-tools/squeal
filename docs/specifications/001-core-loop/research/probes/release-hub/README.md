# release-hub probes (throwaway)

Throwaway fixtures for `../../release-hub.md` (001-163). Nothing here is product code; delete freely.

- `run.sh <empty dir>`: builds a scratch tool repo (shaped like Squeal: `plugins/claude-code`, `plugins/codex`, one version), a scratch hub repo with one marketplace file per harness pinned by `ref` and `sha`, serves both over smart HTTP on 127.0.0.1:8765, and drives `claude plugin` (2.1.295) and `codex plugin` (0.160.1) with `HOME` and `CODEX_HOME` inside the scratch dir. It never touches the real `~/.claude`, `~/.codex` or any real repository.
- `git-http.mjs`: a minimal `git http-backend` server. Claude Code clones shallow, which the dumb HTTP transport refuses, so the probe needs smart HTTP.
- `run.log`: the output of one clean run, 2026-10-09, scratch path replaced by `<scratch>`.
