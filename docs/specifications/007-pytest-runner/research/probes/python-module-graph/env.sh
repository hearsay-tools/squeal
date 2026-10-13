# Source me. Keeps uv's cache, interpreters and any HOME writes inside this probe folder.
PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export UV_CACHE_DIR="$PROBE_DIR/.uv/cache"
export UV_PYTHON_INSTALL_DIR="$PROBE_DIR/.uv/python"
export UV_TOOL_DIR="$PROBE_DIR/.uv/tools"
export UV_NO_CONFIG=1
export UV_PYTHON_PREFERENCE=only-managed
export HOME="$PROBE_DIR/.home"
export XDG_CACHE_HOME="$HOME/.cache" XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$HOME"
