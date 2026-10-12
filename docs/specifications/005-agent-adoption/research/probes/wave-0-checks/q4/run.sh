#!/bin/sh
# Throwaway (005-04, question 4): curl | sh behaviour with this directory's own scripts only.
D=$(cd "$(dirname "$0")" && pwd); PORT=18765; U=http://127.0.0.1:$PORT
# A2/A3: a script larger than the shell's read buffer, written here and removed at the end
{ echo 'echo "step 1"'; echo 'read answer'; echo 'echo "read got: [$(printf %s "$answer" | cut -c1-40)]"'; i=0; while [ $i -lt 2000 ]; do echo ": pad $i ......................"; i=$((i+1)); done; echo 'echo "step 2, after the filler"'; echo 'echo "DONE big"'; } > "$D/naive-big.sh"
node "$D/serve.mjs" $PORT & SRV=$!; sleep 0.5
echo "/bin/sh is $(readlink -f /bin/sh); curl $(curl --version | head -1 | cut -d' ' -f2)"
c() { echo; echo "== $1"; shift; ( eval "$*" ); echo "[pipeline exit $?]"; }
c "A: naive script, whole, read under a pipe" "curl -fsSL $U/naive.sh | sh"
c "B: naive script cut mid-download" "curl -fsSL $U/cut/naive.sh | sh"
c "C: guarded (main at the end) cut mid-download" "curl -fsSL $U/cut/guarded.sh | sh"
c "D: 404, curl -f, plain pipe" "curl -fsSL $U/missing.sh | sh"
c "D2: 404 under bash -o pipefail" "bash -o pipefail -c 'curl -fsSL $U/missing.sh | sh'"
c "E: guarded, no controlling terminal (setsid)" "curl -fsSL $U/guarded.sh | setsid -w sh"
c "E2: guarded, inside a terminal (script -qc)" "script -qec 'curl -fsSL $U/guarded.sh | sh' /dev/null"
c "F: arguments through the pipe (sh -s -- --uninstall)" "curl -fsSL $U/guarded.sh | sh -s -- --uninstall; printf 'main() { echo \"args: \$*\"; }; main \"\$@\"\n' | sh -s -- --uninstall --yes"
c "A2: read early in an 80 KB script, dash" "curl -fsSL $U/naive-big.sh | sh | grep -v pad"
c "A3: the same under bash" "curl -fsSL $U/naive-big.sh | bash | grep -v pad"
kill $SRV; rm -f "$D/naive-big.sh"
