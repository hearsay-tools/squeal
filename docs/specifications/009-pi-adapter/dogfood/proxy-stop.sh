#!/bin/sh
# Stops the logging proxy (only the squeal-e2e node process; sudo's parent exits with it).
sudo -n -u squeal-e2e pkill -u squeal-e2e -f 'dogfood-009/scripts/proxy.mjs' || true
