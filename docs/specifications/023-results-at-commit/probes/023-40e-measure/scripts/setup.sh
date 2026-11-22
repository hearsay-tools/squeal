#!/usr/bin/env bash
# Sandbox setup: the subject chain at ~/r, installed.
set -euo pipefail
cd ~
git clone -q m/chain.bundle r -b measure-chain-40e
cd r
git log --oneline | cat
node --version; pnpm --version
pnpm install --frozen-lockfile > ~/r-install.log 2>&1; tail -2 ~/r-install.log
