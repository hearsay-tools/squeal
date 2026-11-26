#!/usr/bin/env bash
# Throwaway probe (spec 028 research). Runs the report-shape fixtures with the
# streaming reporter. Usage: run-report.sh <installDir> <out.ndjson> [jest args...]
set -u
here=$(cd "$(dirname "$0")" && pwd)
inst=$1 out=$2; shift 2
rm -rf "$inst/fx" "$out"; cp -r "$here/fixture" "$inst/fx"; cd "$inst/fx"
REPORT_OUT="$out" "$inst/node_modules/.bin/jest" --config jest.report.config.js \
  --cacheDirectory="$(dirname "$out")/cache-report" --reporters="$here/squeal-reporter.cjs" "$@" >/dev/null 2>&1
echo "exit=$?"
