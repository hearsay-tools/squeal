#!/bin/bash
# edit.sh <clone dir> <scenario> apply|revert <rep>: one scenario's edit, its content unique to the
# repetition so that no tool can answer it from an earlier result; revert restores the committed file.
# Prints the write time (epoch seconds, after the write returns). Throwaway (011-119).
set -e
dir=$1 sc=$2 op=$3 rep=$4
case $sc in
  s-body)  f=src/harness/pi/session.ts;  cmd="s|^  if (location !== null) await endSession|  void \"wm$rep\";\n  if (location !== null) await endSession|" ;;
  s-break) f=src/harness/pi/session.ts;  cmd="s|^  return null;\$|  return \"wm$rep\" as unknown as null;|" ;;
  s-test)  f=test/harness/pi/session.test.ts ;;
  c-body)  f=packages/cezar/src/application-update/helper.ts; cmd="s|^  const { host, port } = restartEndpoint(|  void 'wm$rep';\n  const { host, port } = restartEndpoint(|" ;;
  c-break) f=packages/cezar/src/application-update/helper.ts; cmd="s|/api/v1/health\`|/api/v1/health-wm$rep\`|" ;;
  c-test)  f=packages/cezar/src/application-update/helper.test.ts ;;
  t-cli|t-cli-swp) f=plugin-tools/estimate-pricing/estimate_pricing/cli.py ;;
  t-rules) f=plugin-tools/estimate-pricing/estimate_pricing/rules.py; cmd="s|^    if not found:\$|    _wm = $rep\n    if not found:|" ;;
  t-ts)    f=tools/generator/src/lib/version-guard.ts; cmd="s|^  const violations: VersionViolation\[\] = \[\];|  void 'wm$rep';\n  const violations: VersionViolation[] = [];|" ;;
  *) echo "unknown scenario $sc" >&2; exit 2 ;;
esac
cd "$dir"
swp=$(dirname $f)/.$(basename $f).swp
if [ $sc = t-cli-swp ]; then  # vim: swap file on open, changed 3 s later, write 10 s later, swap removed on quit
  head -c 4096 /dev/urandom > $swp; sleep 3; head -c 4096 /dev/urandom > $swp; sleep 10
fi
if [ $op = revert ]; then git checkout -q -- $f
else
  case $sc in
    s-test) printf '\ndescribe("wm%s", () => {\n  it("passes", () => {\n    expect(%s).toBe(%s);\n  });\n});\n' $rep $rep $rep >> $f ;;
    c-test) printf "\ndescribe('wm%s', () => {\n  it('passes', () => {\n    expect(%s).toBe(%s);\n  });\n});\n" $rep $rep $rep >> $f ;;
    t-cli) echo "# squeal-probe wm$rep" >> $f ;;
    t-cli-swp) echo "# squeal-probe swp wm$rep" >> $f ;;
    *) sed -i "$cmd" $f; git diff --quiet -- $f && { echo "edit did not apply" >&2; exit 3; } ;;
  esac
fi
date +%s.%N
[ $sc = t-cli-swp ] && rm -f $swp
exit 0
