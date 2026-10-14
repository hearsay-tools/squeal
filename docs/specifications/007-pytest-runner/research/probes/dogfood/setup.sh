#!/bin/sh
# Throwaway probe for 007-18: the case root /home/squeal-e2e/runs/sq07-18, as squeal-e2e.
#   sh setup.sh <step>...
#     dirs     the case directories, uv 0.12.2 copied into its bin
#     pin      `git archive` of Squeal $SQ (main, 0.1.174) plugins and marketplaces into pin/,
#              both marketplaces renamed `hearsay` (the id setup and Codex trust expect, 005-18)
#     clone    beeware/briefcase at $BC into repo/, on a local branch `dogfood`
#     sync     `uv venv` (Python 3.13, uv-managed) and `uv pip install -e . --group test` in repo/,
#              the route AGENTS.md gives with pip; `uv sync` cannot lock: the `docs` group needs
#              Python >= 3.12 against requires-python >= 3.11; the same for debugger/, the
#              second pytest project setup finds (4 test files), with both extras
#     install  both plugins at user scope in the case's CLAUDE_CONFIG_DIR and CODEX_HOME, the
#              launcher as bin/squeal; Codex's config is rel-0168's provider block (no secret in
#              it: the key is named by env_key) with model gpt-6.1-sol
#     setup    `squeal setup --yes --no-warmup` in repo/ (the baseline is timed on its own), its
#              changes committed on `dogfood` so linked worktrees carry them
#     bench    a clone of repo/ at `dogfood` with its own environments and store, for the
#              batch-size baselines and the project's own pytest run
# No model runs here. Each step's output goes to stdout; the caller keeps a trimmed copy.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
R=/home/squeal-e2e/runs/sq07-18
SQ=7debdef9
BC=bffc7303f605bbe8e8d079ace3292effeb6b9953
WT=/home/agent/projects/squeal/.ai/cezar/worktrees/c93d1ae0-75c1-40b2-87d5-784d9bc9e190
as() { dir=$1; shift; node "$here/as-e2e.mjs" "$R" "$R/$dir" "$@"; }
e2e() { sudo -n -u squeal-e2e "$@"; }

for step in "$@"; do
  echo "== $step $(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg)"
  case "$step" in
    dirs)
      e2e mkdir -p "$R/home" "$R/tmp" "$R/codex" "$R/claude" "$R/xdg" "$R/evals" "$R/bin" "$R/uv" "$R/pin" "$R/logs"
      e2e sh -c 'cat > "$1" && chmod 755 "$1"' sh "$R/bin/uv" < /home/agent/.local/bin/uv
      as . uv --version
      ;;
    pin)
      e2e rm -rf "$R/pin" && e2e mkdir "$R/pin"
      git -C "$WT" archive "$SQ" plugins .claude-plugin .agents/plugins | e2e tar -x -C "$R/pin"
      e2e sed -i '0,/"name": "squeal"/s//"name": "hearsay"/' "$R/pin/.agents/plugins/marketplace.json" "$R/pin/.claude-plugin/marketplace.json"
      e2e grep -h '"name"' "$R/pin/.agents/plugins/marketplace.json" "$R/pin/.claude-plugin/marketplace.json"
      ;;
    clone)
      as . git clone -q https://github.com/beeware/briefcase.git repo
      as repo git checkout -q -b dogfood "$BC"
      as repo git config user.name dogfood
      as repo git config user.email dogfood@squeal-e2e.invalid
      as repo git log --oneline -1
      ;;
    sync)
      as repo uv venv -q --clear --python 3.13 --managed-python .venv
      as repo uv pip install -q -e . --group test
      as repo/debugger uv venv -q --clear --python 3.13 --managed-python .venv
      as repo/debugger uv pip install -q -e '.[pdb,debugpy]' --group test
      as repo .venv/bin/python -c 'import sys, pytest; print(sys.version, pytest.__version__)'
      ;;
    install)
      e2e sh -c 'sed -e "s/^model = .*/model = \"gpt-6.1-sol\"/" "$1" > "$2"' sh \
        /home/squeal-e2e/runs/rel-0168/home/.codex/config.toml "$R/codex/config.toml"
      e2e cp "$R/pin/plugins/claude-code/bin/squeal-launcher" "$R/bin/squeal"
      e2e ln -sf /home/squeal-e2e/.npm-global/bin/claude "$R/bin/claude"
      e2e ln -sf /home/squeal-e2e/.npm-global/bin/codex "$R/bin/codex"
      as . claude plugin marketplace add "$R/pin"
      as . claude plugin install squeal@hearsay
      as . codex plugin marketplace add "$R/pin"
      as . codex plugin add squeal@hearsay
      as . squeal --version
      ;;
    setup)
      as repo squeal setup --yes --no-warmup
      as repo git status --short
      as repo git add -A
      as repo git commit -q -m "squeal setup (007-18 dogfood)"
      as repo git log --oneline -1
      ;;
    bench)
      # a separate clone for the batch-size baselines and the project's own run: its own store
      as . git clone -q repo bench
      as bench git checkout -q dogfood
      as bench uv venv -q --clear --python 3.13 --managed-python .venv
      as bench uv pip install -q -e . --group test
      as bench/debugger uv venv -q --clear --python 3.13 --managed-python .venv
      as bench/debugger uv pip install -q -e '.[pdb,debugpy]' --group test
      as bench git log --oneline -1
      ;;
    *) echo "unknown step $step"; exit 2 ;;
  esac
done
