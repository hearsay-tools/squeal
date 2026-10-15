#!/bin/sh
# Copies this directory's scripts into the dogfood user's scripts directory.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sudo -n -u squeal-e2e mkdir -p /home/squeal-e2e/dogfood-008/scripts
tar -C "$here" -cf - --exclude=logs . | sudo -n -u squeal-e2e -H tar -C /home/squeal-e2e/dogfood-008/scripts -xf -
