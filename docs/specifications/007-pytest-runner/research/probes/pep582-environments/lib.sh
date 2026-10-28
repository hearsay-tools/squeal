# Shared setup for the pep582-environments probes. Throwaway.
P=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
S=$P/scratch
mkdir -p $S/home $S/pdm-home $S/pdm-cache
# PDM, its config, caches and any interpreter it installs stay under scratch/, never the real HOME.
export HOME=$S/home XDG_CONFIG_HOME=$S/home/.config XDG_CACHE_HOME=$S/home/.cache XDG_DATA_HOME=$S/home/.local/share XDG_STATE_HOME=$S/home/.local/state
export PDM_HOME=$S/pdm-home PDM_CACHE_DIR=$S/pdm-cache PDM_CHECK_UPDATE=false PDM_NON_INTERACTIVE=1
# uv-managed interpreters for the probe live under scratch/pythons.
export UV_PYTHON_INSTALL_DIR=$S/pythons UV_CACHE_DIR=$S/uv-cache UV_PYTHON_BIN_DIR=$S/pythons/bin
unset VIRTUAL_ENV CONDA_PREFIX PYTHONPATH PYTHONHOME PDM_PROJECT PDM_PYTHON
T=$S/tools/.venv/bin
show() { sed "s#$S#<S>#g"; }
load() { echo "load(1m) $(cut -d' ' -f1 /proc/loadavg) on $(nproc) CPUs"; }
ms() { local s=$(date +%s%N); "$@" >/dev/null 2>&1; local rc=$?; echo "$(( ($(date +%s%N)-s)/1000000 )) ms (exit $rc): $*"; }
