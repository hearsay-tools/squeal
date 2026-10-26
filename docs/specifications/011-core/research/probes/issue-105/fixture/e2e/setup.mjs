import { execFileSync } from 'node:child_process'

// Like cezarion's environment.ts: a shell script (not observed by the recorder) boots the
// environment and writes .ai/qa/test-env.json and .ai/qa/build/ (test-env-up.sh, build-e2e.sh).
export function setup() {
  execFileSync('sh', ['scripts/env-up.sh'], { cwd: import.meta.dirname + '/..', stdio: 'inherit' })
}
