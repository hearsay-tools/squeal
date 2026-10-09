#!/bin/sh
# Throwaway (005-05): a PATH shim that resolves the installed plugin at each call.
cli=$(node "$(dirname "$0")/resolve.mjs") || exit 1
exec node --disable-warning=ExperimentalWarning "$cli" "$@"
