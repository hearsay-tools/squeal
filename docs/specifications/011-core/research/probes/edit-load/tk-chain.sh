#!/bin/sh
S=/tmp/el143; SQ="$S/env.sh node $S/squeal-q1/plugins/claude-code/dist/cli/squeal.mjs"; U=el143-q1tk2
CG=/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$U.scope
cd $S/toolkit
systemd-run --user --scope --quiet --unit $U taskset -c 12-15 nice -n 10 $SQ start > /dev/null 2>&1
timeout 600 $SQ status --wait 500000 > /dev/null 2>&1
T0=$(date +%s%3N); c0=$(awk '/^usage_usec/{print $2}' $CG/cpu.stat); l0=$(cut -d' ' -f1 /proc/loadavg)
timeout 3000 $SQ run --all --wait > $S/logs/tk2-runall.out 2>&1
c1=$(awk '/^usage_usec/{print $2}' $CG/cpu.stat)
echo "tk2-runall t0=$T0 wall_ms=$(( $(date +%s%3N) - T0 )) cpu_s=$(( (c1-c0)/1000000 )) load1_start=$l0 load1_end=$(cut -d' ' -f1 /proc/loadavg)" > $S/logs/tk2-runall.txt
E=$S/edit.sh
timeout 900 $E $S/toolkit $U scripts/metrics/tests/test_m16_e2e_health.py tk2-test '#' > /dev/null
timeout 900 $E $S/toolkit $U scripts/metrics/ui/src/lib/metricOutcome.ts tk2-leaf > /dev/null
timeout 1200 $E $S/toolkit $U plugin-tools/project-graph/project_graph/views.py tk2-mid '#' > /dev/null
timeout 1200 $E $S/toolkit $U plugins/apptension-e2e-testing/skills/e2e-setup/scripts/manifest.mjs tk2-hub > /dev/null
echo done >> $S/logs/tk2-runall.txt
