#!/bin/sh
# The one step of Squeal's GitHub Action (spec 018 D20, ci/action.yml). It
# puts ci/bin on the job's PATH, so the job's later steps have `squeal`, and
# checks that Squeal can run with the node on the PATH. It always exits 0.
# When Squeal cannot run, it warns in the job log and the step summary, and
# `squeal` passes through (ci/lib.sh). When the CLI does not start on a Node
# that meets the floor, it tells `squeal` so through $GITHUB_ENV.
case $0 in
  */*) squeal_ci_action=${0%/*} ;;
  *) squeal_ci_action=. ;;
esac
squeal_ci_action=$(cd "$squeal_ci_action" && pwd)
squeal_ci_root=$squeal_ci_action/..
. "$squeal_ci_action/lib.sh"

if [ -n "${GITHUB_PATH-}" ]; then
  printf '%s\n' "$squeal_ci_action/bin" >>"$GITHUB_PATH"
fi

squeal_ci_passes="The squeal command passes through: squeal ci record runs the command without recording, and squeal ci export and squeal ci publish do nothing. Each squeal call checks again, so a Node that a later step puts on the PATH counts there."

if ! squeal_ci_ready; then
  squeal_ci_warn "Squeal cannot run here: $squeal_ci_problem. $squeal_ci_passes"
  exit 0
fi
squeal_ci_node=$(node -v)
if squeal_ci_version=$(node --disable-warning=ExperimentalWarning "$squeal_ci_cli" --version 2>&1); then
  echo "Squeal $squeal_ci_version on Node $squeal_ci_node: squeal ci record, squeal ci export and squeal ci publish are on the PATH."
  exit 0
fi
squeal_ci_problem="Squeal's CLI does not start on Node $squeal_ci_node: $(squeal_ci_line "$squeal_ci_version")"
if [ -n "${GITHUB_ENV-}" ]; then
  { printf 'SQUEAL_CI_SETUP_FAILED=%s\n' "$squeal_ci_problem" >>"$GITHUB_ENV"; } 2>/dev/null || :
fi
squeal_ci_warn "Squeal cannot run here: $squeal_ci_problem. $squeal_ci_passes"
exit 0
