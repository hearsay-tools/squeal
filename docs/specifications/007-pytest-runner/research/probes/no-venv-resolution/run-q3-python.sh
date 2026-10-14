#!/usr/bin/env bash
# Throwaway (007-04) Q3: which interpreter does a plain `uv sync` pick, and is that knowable from files?
# uv-managed 3.10.20 and 3.13.14 are both installed in this probe's .uv/python.
set -uo pipefail
P="$(cd "$(dirname "$0")" && pwd)"; source "$P/env.sh"
W=$P/work/q3py; rm -rf $W; mkdir -p $W
ver() { sed -n 's/^version_info = //p' $1/.venv/pyvenv.cfg; }
cp -r $P/work/fix/small $W/nopin; rm -rf $W/nopin/.venv*; (cd $W/nopin && uv sync -q --locked); echo "no .python-version, requires-python >=3.10: $(ver $W/nopin)"
cp -r $P/work/fix/small $W/pin; rm -rf $W/pin/.venv*; echo 3.10 > $W/pin/.python-version; (cd $W/pin && uv sync -q --locked); echo ".python-version 3.10, UV_NO_CONFIG=1 (ignores the pin file): $(ver $W/pin)"
rm -rf $W/pin/.venv; (cd $W/pin && env -u UV_NO_CONFIG uv sync -q --locked); echo ".python-version 3.10, UV_NO_CONFIG unset (HOME and XDG still inside the probe, no /etc/uv): $(ver $W/pin)"
cp -r $P/work/fix/small $W/env; rm -rf $W/env/.venv*; (cd $W/env && UV_PYTHON=3.10 uv sync -q --locked); echo "UV_PYTHON=3.10 in the environment, no pin file: $(ver $W/env)"
echo "uv.lock names: $(grep -m1 '^requires-python' $P/work/fix/small/uv.lock)"
