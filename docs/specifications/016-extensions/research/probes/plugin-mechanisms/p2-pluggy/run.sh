#!/bin/sh
# Installs pluggy into a throwaway venv under /tmp; nothing lands in the repository.
set -e
V=${TMPDIR:-/tmp}/pm16-pluggy-venv
python3 -m venv "$V" && "$V/bin/pip" -q install pluggy==1.7.0
"$V/bin/python" -I "$(dirname "$0")/probe.py"
