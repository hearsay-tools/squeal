# Shared by ci/setup.sh and ci/bin/squeal, Squeal's GitHub Action (spec 018
# D20). The caller sets squeal_ci_root to the root of this checkout of Squeal.
# Shell builtins and node only: a pass-through must work with nothing else on
# the PATH.

squeal_ci_cli=$squeal_ci_root/plugins/claude-code/dist/cli/squeal.mjs

# Prints why and exits 1 when the running Node is older than engines.node in
# the package.json it is given, Squeal's one Node floor. Old JavaScript, so
# that an old Node can say so too.
squeal_ci_floor_js='
var file = process.argv[1], floor = null;
try {
  floor = /^>=(\d+)\.(\d+)$/.exec(JSON.parse(require("fs").readFileSync(file, "utf8")).engines.node);
} catch (error) {}
if (floor === null) {
  console.log("cannot read the Node floor in " + file);
  process.exit(1);
}
var have = process.versions.node.split(".").map(Number), major = +floor[1], minor = +floor[2];
if (have[0] < major || (have[0] === major && have[1] < minor)) {
  console.log("Squeal needs Node " + major + "." + minor + " or later, and node is " + process.versions.node);
  process.exit(1);
}'

# The first line of $1.
squeal_ci_line() {
  printf '%s' "${1%%
*}"
}

# $1 with each % as %25, for the data of a workflow command.
squeal_ci_escape() {
  squeal_ci_rest=$1
  squeal_ci_out=
  while :; do
    case $squeal_ci_rest in
      *%*)
        squeal_ci_out=$squeal_ci_out${squeal_ci_rest%%\%*}%25
        squeal_ci_rest=${squeal_ci_rest#*%}
        ;;
      *)
        printf '%s' "$squeal_ci_out$squeal_ci_rest"
        return
        ;;
    esac
  done
}

# Returns 0 when Squeal can run with the node on the PATH; otherwise sets
# squeal_ci_problem to why, in one line, and returns 1. A setup that found the
# CLI broken says so in SQUEAL_CI_SETUP_FAILED, through $GITHUB_ENV.
squeal_ci_ready() {
  if [ -n "${SQUEAL_CI_SETUP_FAILED-}" ]; then
    squeal_ci_problem=$(squeal_ci_line "$SQUEAL_CI_SETUP_FAILED")
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    squeal_ci_problem="node is not on the PATH"
    return 1
  fi
  if [ ! -f "$squeal_ci_cli" ]; then
    squeal_ci_problem="this checkout of Squeal has no plugins/claude-code/dist/cli/squeal.mjs"
    return 1
  fi
  if squeal_ci_problem=$(node -e "$squeal_ci_floor_js" "$squeal_ci_root/package.json" 2>&1); then
    return 0
  fi
  squeal_ci_problem=$(squeal_ci_line "${squeal_ci_problem:-node could not check its version}")
  return 1
}

# A warning in the job log, and in the step summary when there is one.
squeal_ci_warn() {
  printf '::warning title=Squeal::%s\n' "$(squeal_ci_escape "$1")"
  if [ -n "${GITHUB_STEP_SUMMARY-}" ]; then
    { printf '**Squeal:** %s\n\n' "$1" >>"$GITHUB_STEP_SUMMARY"; } 2>/dev/null || :
  fi
}

# The line of the error output in file $1 that states the error: a refusal's
# "wrote nothing" or "published nothing", else a thrown error's "...Error: ...",
# else the first line that is not empty; nothing when there is none.
squeal_ci_error_line() {
  squeal_ci_refusal=
  squeal_ci_thrown=
  squeal_ci_first=
  while IFS= read -r squeal_ci_l || [ -n "$squeal_ci_l" ]; do
    case $squeal_ci_l in
      *"wrote nothing" | *"published nothing") : "${squeal_ci_refusal:=$squeal_ci_l}" ;;
      *Error:*) : "${squeal_ci_thrown:=$squeal_ci_l}" ;;
    esac
    case $squeal_ci_l in
      *[![:space:]]*) : "${squeal_ci_first:=$squeal_ci_l}" ;;
    esac
  done <"$1"
  printf '%s' "${squeal_ci_refusal:-${squeal_ci_thrown:-$squeal_ci_first}}"
}

# Squeal runs `squeal ci export` or `squeal ci publish` ("$@"). A refusal or a
# crash (any exit but 0 and 2) warns with the command and its error line, and
# exits 0: the run's result stays as it would be without Squeal (the
# coordinator for the human, 2026-11-11). A usage error, exit 2, is a mistake
# in the CI file and fails. Its output streams as it comes; a copy of the
# error output goes to a file under $RUNNER_TEMP, removed afterwards.
squeal_ci_shared() {
  squeal_ci_err=${RUNNER_TEMP:-${TMPDIR:-/tmp}}/squeal-ci-$$.err
  {
    {
      node --disable-warning=ExperimentalWarning "$squeal_ci_cli" "$@" 2>&1 1>&3 3>&-
      echo $? >"$squeal_ci_err.code"
    } | tee "$squeal_ci_err" >&2
  } 3>&1
  squeal_ci_code=1
  read -r squeal_ci_code <"$squeal_ci_err.code"
  squeal_ci_said=$(squeal_ci_error_line "$squeal_ci_err")
  rm -f "$squeal_ci_err" "$squeal_ci_err.code"
  case $squeal_ci_code in
    0 | 2) exit "$squeal_ci_code" ;;
  esac
  if [ -n "$squeal_ci_said" ]; then
    squeal_ci_said=": $squeal_ci_said"
  else
    squeal_ci_said=" with no error output"
  fi
  squeal_ci_warn "squeal $1 $2 failed (exit $squeal_ci_code)$squeal_ci_said. The run's result stays as it is; it shares no Squeal results."
  exit 0
}

# Squeal cannot run (squeal_ci_problem says why): `squeal ci record -- <command>`
# runs the command in this process, so its exit code and signals are the
# step's; `squeal ci export` and `squeal ci publish` exit 0. Any other command
# exits 1, since Squeal did not run it. A record with no command is a usage
# error, as in the CLI.
squeal_ci_pass_through() {
  squeal_ci_cannot="Squeal cannot run here: $squeal_ci_problem."
  case ${1-}:${2-} in
    ci:record)
      shift 2
      while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
      if [ $# -le 1 ]; then
        squeal_ci_warn "$squeal_ci_cannot squeal ci record found no command after --."
        echo "squeal ci record: no command after --" >&2
        echo "usage: squeal ci record [--out <dir>] -- <command> [args...]" >&2
        exit 2
      fi
      shift
      squeal_ci_warn "$squeal_ci_cannot The command runs without recording, so this step shares no results."
      exec "$@"
      ;;
    ci:export | ci:publish)
      squeal_ci_warn "$squeal_ci_cannot squeal ci $2 did nothing."
      exit 0
      ;;
    *)
      squeal_ci_warn "$squeal_ci_cannot squeal $* did not run."
      exit 1
      ;;
  esac
}
