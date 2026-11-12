# Throwaway: one revision touching the listed test files (appends a comment line), then the
# time until squeal status --wait gives their verdict. Usage: sh edit-run.sh <tag> <file>...
tag=$1; shift
cd $T/clone
s=$(date +%s%N)
for f in "$@"; do printf '// trial %s\n' "$tag" >> "$f"; done
node $T/clone/plugins/claude-code/dist/cli/squeal.mjs status --wait 900000 "$@" > $T/last-wait.txt 2>&1; code=$?
e=$(date +%s%N)
echo "$tag: $(( (e-s)/1000000 )) ms exit $code load $(cut -d' ' -f1 /proc/loadavg)"
