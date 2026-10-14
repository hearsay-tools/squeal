#!/usr/bin/env bash
# Spec 008 wave-0 checks 1 and 2: which variables confine OpenCode 1.18.35 to a run directory,
# and does it load the scripted provider with no package fetch? OpenCode runs only as the
# throwaway user squeal-e2e: run from the agent user, this script copies itself and the fixture
# into that user's home and runs there; it never starts OpenCode as any other user.
#   bash test/fixtures/opencode/isolation-check.sh      (KEEP=1 keeps the temp directory)
# Under strace, `opencode --version` (what opencode-ai's postinstall runs), then `opencode run`
# and an `opencode serve` turn, each a scripted `write` then a text, under two environments:
#   bare      HOME and PATH only, OpenCode's defaults;
#   unseeded  every variable test/helpers/opencode.ts sets, pointed into the temp directory;
#   helper    the same with the config directories seeded as the helper seeds them.
# The provider's config sits in OPENCODE_CONFIG_DIR as the helper puts it, except under bare,
# where it is the project's opencode.json.
# Reported: every file-changing syscall outside the temp directory, every path under the real
# HOME looked at, every non-local connect, and a HOME snapshot diff (path, size, mtime).
set -eu
if [ "$(id -un)" != squeal-e2e ]; then
  HERE=$(cd "$(dirname "$0")" && pwd)
  E2E=(sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e
    PATH=/home/squeal-e2e/.npm-global/bin:/opt/squeal-e2e/node24/bin:/usr/bin:/bin)
  D=/home/squeal-e2e/opencode-isolation
  tar -C "$HERE" -cf - scripted-provider.ts serve-drive.mjs isolation-check.sh \
    | "${E2E[@]}" bash -c "rm -rf $D && mkdir -p $D && tar -C $D -xf -"
  exec "${E2E[@]}" KEEP="${KEEP:-}" bash -c "cd / && bash $D/isolation-check.sh $D" </dev/null
fi
D=$1
[ "$(opencode --version)" = 1.18.35 ] || { echo "needs OpenCode 1.18.35 in squeal-e2e's ~/.npm-global" >&2; exit 2; }
T=$(mktemp -d /tmp/oc-iso.XXXXXX)
mkdir -p "$T/out"
cat > "$T/plan.json" <<'EOF'
[{ "tools": [{ "name": "write", "arguments": { "filePath": "out.txt", "content": "written\n" } }] },
 { "text": "done" }]
EOF

# The helper's seed: a config directory whose node_modules exists and whose lock lists
# @opencode-ai/plugin is one OpenCode does not npm-install into (packages/core/src/npm.ts).
seed() {
  mkdir -p "$1/node_modules"
  echo '{"dependencies":{"@opencode-ai/plugin":"1.18.35"}}' > "$1/package.json"
  echo '{"lockfileVersion":3,"packages":{"":{"dependencies":{"@opencode-ai/plugin":"1.18.35"}}}}' \
    > "$1/package-lock.json"
}
# A fresh run directory per environment, as the helper makes per run.
fresh() {
  rm -rf "$T/home" "$T/tmp" "$T/xdg" "$T/opencode-config"
  mkdir -p "$T/home" "$T/tmp" "$T/opencode-config" "$T/xdg/config/opencode" \
    "$T/xdg/data" "$T/xdg/cache" "$T/xdg/state"
}

# ~/runs holds the eval harness's cells, which run as squeal-e2e concurrently; strace is the check
# immune to concurrent writers, the snapshot a second one.
snapshot() {
  find "$HOME" -xdev -path "$HOME/runs" -prune -o -printf '%p\t%s\t%T@\n' 2>/dev/null
  find /tmp /var/tmp /dev/shm -xdev -path "$T" -prune -o -user "$(id -un)" -printf '%p\t%s\t%T@\n' 2>/dev/null
}
snapshot | sort > "$T/out/home.before"

BARE=(env -i HOME="$HOME" PATH="$PATH")
HELPER=(env -i PATH="$PATH" HOME="$T/home" TMPDIR="$T/tmp"
  XDG_CONFIG_HOME="$T/xdg/config" XDG_DATA_HOME="$T/xdg/data"
  XDG_CACHE_HOME="$T/xdg/cache" XDG_STATE_HOME="$T/xdg/state"
  OPENCODE_CONFIG_DIR="$T/opencode-config"
  OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1)
TRACE=(strace -f -qq -e trace=%file,%desc,%network -e signal=none -s 256)

# A fresh git project and a fresh provider per run: the plan restarts at request 0.
project() {
  local name=$1 config=$2
  rm -rf "$T/proj" && mkdir -p "$T/proj" && git -C "$T/proj" init -q
  rm -f "$T/url"
  node "$D/scripted-provider.ts" "$T/plan.json" "$T/out/requests.$name.jsonl" "$T/url" &
  PROVIDER=$!
  for _ in $(seq 50); do [ -s "$T/url" ] && break; sleep 0.1; done
  cat > "$config/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": { "scripted": { "npm": "@ai-sdk/openai-compatible", "name": "Scripted",
    "options": { "baseURL": "$(cat "$T/url")", "apiKey": "not-a-credential" },
    "models": { "scripted-1": { "name": "Scripted 1" }, "scripted-small": { "name": "Scripted small" } } } },
  "model": "scripted/scripted-1",
  "small_model": "scripted/scripted-small",
  "permission": { "edit": "allow", "bash": "allow" },
  "share": "disabled",
  "autoupdate": false
}
EOF
}
done_project() { kill "$PROVIDER"; wait "$PROVIDER" 2>/dev/null || true; }

cd /
"${BARE[@]}" "${TRACE[@]}" -o "$T/out/strace.version.bare" opencode --version \
  > "$T/out/stdout.version.bare" 2> "$T/out/stderr.version.bare"; echo "exit $?" >> "$T/out/stderr.version.bare"
for env in bare unseeded helper; do
  fresh
  config=$T/opencode-config
  case $env in
    bare) E=("${BARE[@]}"); config=$T/proj ;;
    unseeded) E=("${HELPER[@]}") ;;
    helper) E=("${HELPER[@]}"); seed "$T/xdg/config/opencode"; seed "$T/opencode-config" ;;
  esac
  project "run.$env" "$config"
  (cd "$T/proj" && "${E[@]}" "${TRACE[@]}" -o "$T/out/strace.run.$env" \
    opencode run --format json -m scripted/scripted-1 "write out.txt" \
    < /dev/null > "$T/out/stdout.run.$env" 2> "$T/out/stderr.run.$env"; echo "exit $?" >> "$T/out/stderr.run.$env")
  echo "out.txt: $(cat "$T/proj/out.txt" 2>/dev/null)" >> "$T/out/stderr.run.$env"
  done_project
  [ $env = unseeded ] && continue
  project "serve.$env" "$config"
  (cd "$T/proj" && "${E[@]}" node "$D/serve-drive.mjs" "$T/proj" "write out.txt" \
    "${TRACE[@]}" -o "$T/out/strace.serve.$env" opencode serve --hostname 127.0.0.1 --port 0 \
    > "$T/out/stdout.serve.$env" 2> "$T/out/stderr.serve.$env" || echo "exit $?" >> "$T/out/stderr.serve.$env")
  echo "out.txt: $(cat "$T/proj/out.txt" 2>/dev/null)" >> "$T/out/stderr.serve.$env"
  done_project
done

snapshot | sort > "$T/out/home.after"
echo "temp dir: $T"
# Condenses one strace log: paths deeper than five levels are cut to five, Bun's native-module
# extractions (opened relative to TMPDIR's fd) are named as such, and each line is counted.
SUMMARY='
  const [file, T, HOME] = process.argv.slice(1);
  const WRITE = /^(creat|mkdir|mkdirat|rmdir|rename|renameat2?|unlink|unlinkat|link|linkat|symlink|symlinkat|chmod|fchmodat|chown|fchownat|lchown|utimensat|utimes|truncate)$/;
  const cut = (path) => path.split("/").length > 6 ? `${path.split("/").slice(0, 6).join("/")}/...` : path;
  const inside = (path) => path === T || path.startsWith(`${T}/`);
  const lines = { write: new Map(), read: new Map(), connect: new Map() };
  const count = (kind, key) => lines[kind].set(key, (lines[kind].get(key) ?? 0) + 1);
  for (const line of require("node:fs").readFileSync(file, "utf8").split("\n")) {
    const call = line.match(/^\d+ +([a-z0-9_]+)\((.*)$/);
    if (!call) continue;
    const [, name, rest] = call;
    const result = rest.match(/= (-1 [A-Z]+|\d+)/)?.[1] ?? "unfinished";
    const outcome = result.startsWith("-1") ? result.slice(3) : result === "unfinished" ? "unfinished" : "ok";
    if (name === "connect") {
      if (/AF_UNIX|AF_UNSPEC|127\.0\.0\.1|::1"|::ffff:127/.test(rest)) continue;
      const port = rest.match(/htons\((\d+)\)/)?.[1];
      const addr = rest.match(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/);
      count("connect", `connect ${addr?.[1] ?? addr?.[2]}:${port}`);
      continue;
    }
    const path = rest.match(/"([^"]*)"/)?.[1];
    if (path === undefined) continue;
    const writes = WRITE.test(name) || (/^(open|openat)$/.test(name) && /O_(WRONLY|RDWR|CREAT)/.test(rest));
    if (writes) {
      if (inside(path) || /^\/(dev\/(null|tty|pts)|proc\/)/.test(path)) continue;
      const shown = /^\.[0-9a-f]+-\d+\.(so|node)$/.test(path) ? "<TMPDIR fd>/.<hash>.so|.node (Bun native-module extraction)" : cut(path);
      count("write", `${name} ${shown} ${outcome}`);
    } else if (path.startsWith(`${HOME}/`) && !/\/(\.npm-global|opencode-isolation)\//.test(path)) {
      count("read", `looked at ${cut(path)}`);
    }
  }
  for (const kind of ["write", "read", "connect"])
    for (const [key, n] of [...lines[kind]].sort()) console.log(`  ${key}${n > 1 ? ` (x${n})` : ""}`);
'
for name in version.bare run.bare serve.bare run.unseeded run.helper serve.helper; do
  echo "== $name: $(cat "$T/out/requests.$name.jsonl" 2>/dev/null | wc -l) model requests; $(grep -E '^(exit|out.txt)' "$T/out/stderr.$name" | tr '\n' ' ')"
  # Every file-changing syscall outside the temp dir (write-mode opens, mkdir, rename, unlink,
  # rmdir, links, chmod, utimes, truncate) with its outcome; every path under the real HOME
  # looked at; every connect other than loopback and unix sockets.
  node -e "$SUMMARY" "$T/out/strace.$name" "$T" "$HOME"
done
echo "== changes under HOME (~/runs excluded) and to this user's files in /tmp, /var/tmp, /dev/shm:"
diff "$T/out/home.before" "$T/out/home.after" | grep '^[<>]' | cut -f1 | cut -d/ -f1-6 | sort | uniq -c | sed 's/^/  /' || true
[ -n "${KEEP:-}" ] || rm -rf "$T"
