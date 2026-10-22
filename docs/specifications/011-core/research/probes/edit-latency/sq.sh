#!/bin/bash
# Runs the installed 0.1.263 squeal CLI with HOME, XDG and TMPDIR under /tmp/el115.
export HOME=/tmp/el115/home XDG_RUNTIME_DIR=/tmp/el115/run XDG_CONFIG_HOME=/tmp/el115/home/.config TMPDIR=/tmp/el115/tmp
exec /home/agent/.nvm/versions/node/v24.21.0/bin/node /home/agent/.claude/plugins/cache/hearsay/squeal/0.1.263/dist/cli/squeal.mjs "$@"
