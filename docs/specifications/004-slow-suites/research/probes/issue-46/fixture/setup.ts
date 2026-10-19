import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/** As cezarion's e2e/environment.ts: boot or reuse the shared env; the teardown stops nothing. */
export function setup(): () => void {
  execFileSync('sh', [resolve(import.meta.dirname, 'env-up.sh')], { stdio: 'inherit' })
  return () => {}
}
