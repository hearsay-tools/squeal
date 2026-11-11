#!/usr/bin/env bash
# Throwaway (row 021-02): compare git blob ids of the tracked files, local against remote.
# Squeal's file hash is the git blob id of the bytes on disk, so equal ids prove equal content.
set -euo pipefail
. "$(dirname "$0")/env.sh"
L=$RE/local/squeal; R=/work/squeal
cd "$L"; git ls-files -s | awk '$1=="100644"||$1=="100755"{sub(/^[^\t]*\t/,""); print}' > $RE/paths.txt
git hash-object --stdin-paths < $RE/paths.txt > $RE/local.ids
"$RE/sshwrap/ssh" remote "cd $R && git hash-object --stdin-paths" < $RE/paths.txt > $RE/remote.ids 2>$RE/remote.err || echo "remote hash-object failed: $(head -c 300 $RE/remote.err)"
paste -d' ' $RE/local.ids $RE/remote.ids $RE/paths.txt | awk '$1!=$2{d++; if(d<=5) print "differs:", $3} END{print NR" files, "d+0" differ"}'
