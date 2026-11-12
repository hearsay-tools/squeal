#!/bin/sh
# 020-32 end to end (throwaway). The trial job's three scripts, "Build the trial commits", the gate
# step and "Report the trial", taken from a patched Cezar ci.yml, run on the synthetic #194 fixture
# (../../research/probes/issue-194/fixture) with a real Squeal. Everything lives under one mktemp -d,
# with its own HOME and TMPDIR. Refuses when the one-minute load is 24 or more.
# Usage: sh e2e.sh <patched Cezar checkout with node_modules/yaml> <squeal.mjs>
set -u
CEZAR=$1; CLI=$2
HERE=$(cd "$(dirname "$0")" && pwd)
FIXTURE="$HERE/../../research/probes/issue-194/fixture"
LOAD=$(cut -d' ' -f1 /proc/loadavg)
if [ "$(echo "$LOAD >= 24" | bc)" = 1 ]; then echo "load $LOAD >= 24: skipped"; exit 0; fi
echo "load at start: $LOAD on $(getconf _NPROCESSORS_ONLN) CPUs; node $(node --version); squeal $CLI"
W=$(mktemp -d /tmp/w020-32-e2e-XXXXXX)
mkdir -p "$W/bin" "$W/home" "$W/tmp" "$W/steps"
printf '#!/bin/sh\nexec node "%s" "$@"\n' "$CLI" > "$W/bin/squeal"; chmod +x "$W/bin/squeal"
export HOME="$W/home" TMPDIR="$W/tmp" PATH="$W/bin:$PATH" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p

# The steps' scripts and literal env, verbatim from the patched ci.yml.
node -e '
  const fs = require("fs"); const yaml = require(process.argv[1] + "/node_modules/yaml");
  const job = yaml.parse(fs.readFileSync(process.argv[1] + "/.github/workflows/ci.yml", "utf8")).jobs["squeal-package-trial"];
  for (const id of ["commits", "gate", "Report the trial"]) {
    const s = job.steps.find((x) => x.id === id || x.name === id);
    const name = id.replace(/ /g, "-");
    fs.writeFileSync(process.argv[2] + "/" + name + ".sh", s.run);
    const env = Object.entries(s.env ?? {}).filter(([, v]) => !String(v).includes("${{"));
    fs.writeFileSync(process.argv[2] + "/" + name + ".env", env.map(([k, v]) => k + "=" + JSON.stringify(String(v))).join("\n") + "\n");
  }' "$CEZAR" "$W/steps" || exit 2

# The fixture's own entry in place of Cezar's (the job's TRIAL_ENTRY targets packages/cezar).
ENTRY='{"name": "test:package", "argv": [], "include": ["test/e2e/*.test.mjs"], "prepare": {"command": ["node", "scripts/build.mjs"], "timeoutSeconds": 60}}'
UNIT='{ "coverage": { "enabled": true }, "nodeTest": [ { "name": "unit", "argv": [], "include": ["test/unit/*.test.mjs"] } ] }'

mkrepo() { # dir: main has base and one later commit; branch measured has the #194 head edit
  cp -r "$FIXTURE" "$1"; rm "$1/test/e2e/release-inproc.alt"
  printf '%s\n' "$UNIT" > "$1/squeal.config.json"; printf 'dist/\nnode_modules/\n' > "$1/.gitignore"
  (cd "$1" && git init -q -b main && git add -A && git commit -qm base && git checkout -qb measured \
    && sed -i 's|    if (name.startsWith("@private/")) continue;|    if (name.startsWith("@private/")) continue;\n    if (name === "") throw new Error("empty name");|' scripts/release.mjs \
    && sed -i 's|    assert.match(line, /^would publish/);|    assert.match(line, /^would publish/);\n    if (line.endsWith("@private/b")) assert.fail("private package published");|' test/e2e/release.test.mjs \
    && git commit -qam head && git checkout -q main && echo later > later.txt && git add later.txt && git commit -qm later \
    && git update-ref refs/remotes/origin/main HEAD)
}
step() { # dir, label, step name, extra env
  d=$1; l=$2; s=$3; shift 3
  (cd "$d" && set -a && . "$W/steps/$s.env" && set +a && env RUNNER_TEMP="$W/$l" GITHUB_STEP_SUMMARY="$W/$l/summary.md" "$@" \
    bash -e -o pipefail "$W/steps/$s.sh" > "$W/$l/$s.out" 2>&1; echo "  $s: exit $?")
}
trial() { # dir, label, TRIAL_COMMIT
  mkdir -p "$W/$2"; : > "$W/$2/summary.md"
  echo "== $2"
  step "$1" "$2" commits TRIAL_ENTRY="$ENTRY" TRIAL_COMMIT="$3"
  step "$1" "$2" gate
  step "$1" "$2" Report-the-trial GATE=success PACKAGED_TESTS=test/e2e/
  echo "  gate exit: $(cat "$W/$2/squeal-package-trial/exit-code" 2>/dev/null)"
  sed 's/^/  | /' "$W/$2/summary.md"
  echo "  gate stderr:"; sed 's/^/    /' "$W/$2/squeal-package-trial/stderr.txt" 2>/dev/null | head -20
}

echo "### A: the dispatched commit (branch measured) against origin/main"
mkrepo "$W/a"; (cd "$W/a" && git checkout -q --detach measured)
trial "$W/a" A ""

echo "### B: replay of the measured commit, dispatched from main"
mkrepo "$W/b"; HEADSHA=$(cd "$W/b" && git rev-parse measured); (cd "$W/b" && git checkout -q --detach main)
trial "$W/b" B "$HEADSHA"

echo "### C: control, the brief's literal command: the keys committed on the branch only, then squeal code --base origin/main"
mkrepo "$W/c"
(cd "$W/c" && git checkout -q measured \
  && node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync("squeal.config.json","utf8"));c.coverage.children=true;c.nodeTest.push(JSON.parse(process.argv[1]));fs.writeFileSync("squeal.config.json",JSON.stringify(c,null,2)+"\n")' "$ENTRY" \
  && git commit -qam keys && squeal code --base origin/main --json > "$W/c.json" 2> "$W/c.err"; echo "  exit $?")
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("  verdict", r.verdict, "children at base", r.base.policy.coverageChildren ?? false);for(const f of r.functions)console.log("  ", f.path, f.qualifiedName, f.state, f.gap ?? "");for(const run of r.runs)console.log("   run", run.runner, "prepare", JSON.stringify(run.prepare ?? null))' "$W/c.json" 2>/dev/null || echo "  (no JSON)"
grep -i "prepare\|land" "$W/c.err" | head -3 | sed 's/^/  stderr: /'
echo "load at end: $(cut -d' ' -f1 /proc/loadavg)"
echo "kept: $W"
