#!/bin/sh
# Throwaway probe for hearsay-tools/squeal#123 (../../issue-123.md). Re-run: sh run.sh
# A fresh /tmp/i123-XXXXXX with its own HOME and XDG_RUNTIME_DIR; the only daemon started is the
# scratch repository's, stopped at the end. Squeal is a copy of the installed plugin (0.1.374, the
# issue's version, by default; SQUEAL_PLUGIN overrides). 24 fast test files (above the focused
# meta row's 20-file cap), each with parity-style rows named "<runner> U<n> ..."; the issue's rows
# U2, U3, U7*, U12, U13, U19 are fast, every other row sleeps 800 ms.
set -u
plugin_src=${SQUEAL_PLUGIN:-$HOME/.claude/plugins/cache/hearsay/squeal/0.1.374}
read -r load _ </proc/loadavg
cpus=$(nproc)
if [ "$(echo "$load < $cpus" | bc)" != 1 ]; then echo "load $load >= $cpus CPUs; not running"; exit 2; fi
echo "load $load on $cpus CPUs; $(date -u +%FT%TZ)"
S=$(mktemp -d /tmp/i123-XXXXXX)
export HOME=$S/home XDG_RUNTIME_DIR=$S/run npm_config_cache=$S/npm-cache
mkdir -p "$HOME" && mkdir -m 700 "$XDG_RUNTIME_DIR"
cp -a "$plugin_src" "$S/plugin"
sq() { node "$S/plugin/dist/cli/squeal.mjs" "$@"; }
now() { date +%s.%N; }
echo "scratch $S; squeal $(sq --version)"
repo=$S/repo
mkdir -p "$repo/test" && cd "$repo"
printf '{ "name": "i123-fixture", "private": true, "type": "module", "devDependencies": { "vitest": "4.1.10" } }\n' >package.json
printf '{}\n' >squeal.config.json
printf 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n' >vitest.config.ts
for n in $(seq -w 1 24); do
  {
    echo 'import { describe, expect, it } from "vitest";'
    echo 'const slow = () => new Promise((r) => setTimeout(r, 800));'
    echo 'describe("wait list on every native runner wire", () => {'
    for row in U1 U2 U2c U20 U3 U3b U4 U7 U7m U12 U13 U19 U21; do
      case $row in U2|U3|U7|U7m|U12|U13|U19) body='expect(1).toBe(1);' ;; *) body='await slow(); expect(1).toBe(1);' ;; esac
      echo "  it(\"r$n $row row text\", async () => { $body });"
    done
    echo '});'
  } >"test/rows-$n-parity.test.ts"
done
git init -q -b main && git config user.email p@i123 && git config user.name i123
printf 'node_modules\n' >.gitignore
npm install --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
git add -A && git commit -qm fixture
sq start "$repo" 2>&1 | head -3
echo "=== control: vitest -t with the issue's regex, 24 files (unmanaged)"
t0=$(now); npx vitest run test -t ' U(2|3|7|12|13|19)[a-z]* ' 2>&1 | grep -E "Test Files|Tests |Duration" | head -4; t1=$(now)
echo "control wall: $(echo "$t1 - $t0" | bc) s"
echo "=== phase A: focused wait, 24 named files, one text per wanted row family"
t0=$(now)
sq status --wait 120000 test/*-parity.test.ts --check ' U2 ' --check ' U3 ' --check ' U7' --check ' U12 ' --check ' U13 ' --check ' U19 ' >"$S/a.txt" 2>&1; ea=$?
t1=$(now)
head -40 "$S/a.txt"; echo "... ($(wc -l <"$S/a.txt") lines)"; echo "exit $ea; phase A wall: $(echo "$t1 - $t0" | bc) s"
echo "=== phase B: substring ' U2' on one file (prefix of U2c and U20 too)"
sq status --wait 60000 test/rows-01-parity.test.ts --check ' U2' 2>&1 | head -12
echo "=== phase C: the issue's regex as a --check text on one file"
sq status --wait 60000 test/rows-02-parity.test.ts --check ' U(2|3|7|12|13|19)[a-z]* ' 2>&1 | head -8; echo "exit $?"
echo "=== status --check surface"
sq status --help 2>&1 | grep -iE 'check|pattern|regex' | head -6
echo "=== stop"
sq stop "$repo" 2>&1 | head -2
rm -rf "$S"
