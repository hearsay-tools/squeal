# Throwaway: n timed catch-up edits of the unit set, each started only at load1 < 24.
mode=$1; n=$2; cd $T/clone; F=$(cat $T/unit-files.txt); i=0
while [ $i -lt $n ]; do
  l=$(cut -d' ' -f1 /proc/loadavg)
  if [ "$(echo "$l < 24" | bc)" = 1 ]; then i=$((i+1)); echo "start load $l"; sh $T/edit-run.sh $mode$i $F; sleep 3; else sleep 10; fi
done
