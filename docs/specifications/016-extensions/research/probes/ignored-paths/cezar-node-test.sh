#!/usr/bin/env bash
# Throwaway (016-19). Cezar's two node:test projects from its squeal.config.json, each file
# alone (node-test-each.sh). Run under run.sh from the cezar clone's root.
here=$(dirname "$0")
"$here/node-test-each.sh" packages/cezar "--import ../../scripts/test-git-env.mjs --import tsx" packages/cezar/test/unit/*.test.ts
"$here/node-test-each.sh" . "--import ./scripts/test-git-env.mjs" .github/scripts/*.test.cjs scripts/*.test.mjs
