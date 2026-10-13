#!/usr/bin/env bash
# Throwaway: all installations and caches stay below this directory.
set -eu
cd "$(dirname "$0")"
export UV_CACHE_DIR="$PWD/.cache/uv"
export UV_PYTHON_INSTALL_DIR="$PWD/.python"
export XDG_CACHE_HOME="$PWD/.cache"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p .tmp
export TMPDIR="$PWD/.tmp"
for version in 3.10 3.13; do
  uv venv --python "$version" ".venv-$version"
  uv pip install --python ".venv-$version/bin/python" pytest==8.4.2 pytest-xdist==3.8.0 pytest-timeout==2.4.0 pytest-json-report==1.5.0 pytest-asyncio==1.2.0 anyio==4.11.0 pytest-django==4.11.1 Django==5.2.7 syrupy==4.9.1 pytest-cov==7.0.0 setuptools==80.9.0 --requirement "packages-$version.txt"
  uv pip freeze --python ".venv-$version/bin/python" > "packages-$version.txt"
done
