#!/bin/sh
# Q5 probe: cost of cezar's binary-names.test.ts through its wrapper and through the gate with a
# nodeTest entry for test/e2e (the "prepare" design, build done by the wrapper run first).
# Throwaway. Reads ~/projects/cezar only: `git clone --shared` and a copy of node_modules into /tmp.
#   sh cezar-cost.sh <squeal-cli.mjs>      (refuses while the one-minute load is above 24)
set -u
CLI=$1
SRC=$HOME/projects/cezar
HEAD=c817e1302cd2c25df6593867352990b7bc96b225
BASE=a015077ac239bca4912803daf17836b07dda6540
FILE=packages/cezar/test/e2e/binary-names.test.ts
LOAD=$(cut -d' ' -f1 /proc/loadavg)
if [ "$(echo "$LOAD > 24" | bc)" = 1 ]; then echo "load $LOAD > 24: skipped"; exit 0; fi
W=$(mktemp -d /tmp/r174-cezar-XXXXXX)
git clone -q --shared --no-checkout "$SRC" "$W/cezar" && (cd "$W/cezar" && git checkout -q "$HEAD")
echo "lockfile equal to the source checkout's: $(cmp -s "$SRC/pnpm-lock.yaml" "$W/cezar/pnpm-lock.yaml" && echo yes || echo no)"
cp -a "$SRC/node_modules" "$W/cezar/node_modules"
for p in api-client cezar contract web; do [ -d "$SRC/packages/$p/node_modules" ] && cp -a "$SRC/packages/$p/node_modules" "$W/cezar/packages/$p/node_modules"; done
for v in $(env | sed -n 's/^\(CEZ_[A-Z_]*\|HSQ_[A-Z_]*\|CLAUDE[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
export HOME="$W/home" TMPDIR="$W/tmp"; mkdir -p "$HOME" "$TMPDIR"
timed() { # label, command...
  label=$1; shift
  l0=$(cut -d' ' -f1 /proc/loadavg)
  /usr/bin/time -f "%e %U %S" -o "$W/$label.time" "$@" >"$W/$label.out" 2>"$W/$label.err"; code=$?
  set -- $(cat "$W/$label.time" | tail -1)
  echo "$label: exit $code, wall $1 s, cpu $(echo "$2 + $3" | bc) s, load $l0 -> $(cut -d' ' -f1 /proc/loadavg)"
}
cd "$W/cezar"
timed wrapper-cold npm run --silent test:package -- "$FILE"
timed wrapper-warm npm run --silent test:package -- "$FILE"
timed gate-no-entry node "$CLI" code --base "$BASE" "$FILE" --timeout 900 --json
node -e '
  const fs = require("fs"); const c = JSON.parse(fs.readFileSync("squeal.config.json", "utf8"));
  c.nodeTest.push({ name: "test:package", cwd: "packages/cezar", argv: ["--import", "../../scripts/test-home-env.mjs", "--import", "tsx"], include: ["test/e2e/*.test.ts"] });
  c.checks.unshift({ name: "package", runner: "nodeTest", project: "test:package", at: "manual" });
  fs.writeFileSync("squeal.config.json", JSON.stringify(c, null, 2) + "\n");'
timed gate-entry node "$CLI" code --base "$BASE" "$FILE" --timeout 900 --json
for g in gate-no-entry gate-entry; do
  node -e '
    const t = require("fs").readFileSync(process.argv[1], "utf8"); const r = JSON.parse(t);
    console.log(process.argv[2], "verdict", r.verdict);
    for (const f of r.functions) console.log("  ", f.qualifiedName, "line", f.line, f.state, f.gap ?? "", "cc", f.complexity, "cov", JSON.stringify(f.coverage), "crap", f.crap, "loaders", JSON.stringify(f.loaders));
    for (const run of r.runs ?? []) console.log("   run", JSON.stringify(run));
  ' "$W/$g.out" "$g" || tail -5 "$W/$g.err"
done
echo "kept in $W (remove with rm -rf)"
