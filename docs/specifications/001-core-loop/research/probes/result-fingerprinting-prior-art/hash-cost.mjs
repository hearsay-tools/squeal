// Throwaway probe. Measures the cost of per-file content hashes taken from the
// git index versus hashing every file, plus per-check closure-hash recompute.
// Usage: node hash-cost.mjs <repo>
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.argv[2]
const git = (cwd, ...args) => execFileSync('git', args, { cwd, maxBuffer: 1 << 28 })
const time = (label, fn) => {
  const t = process.hrtime.bigint(); const r = fn()
  console.log(`${label}: ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1)} ms`)
  return r
}
const parseIndex = (buf) => {
  const m = new Map()
  for (const rec of buf.toString().split('\0')) {
    if (!rec) continue
    const [meta, path] = rec.split('\t'); const [mode, oid] = meta.split(' ')
    if (mode !== '160000') m.set(path, oid) // skip submodules
  }
  return m
}

git(repo, 'status', '--porcelain') // warm the index stat cache once
const idx = time('git ls-files -s -z (index oids)', () => parseIndex(git(repo, 'ls-files', '-s', '-z')))
time('git status --porcelain -z', () => git(repo, 'status', '--porcelain', '-z', '--untracked-files=all'))
time('lstat every tracked file', () => { for (const p of idx.keys()) try { lstatSync(join(repo, p)) } catch {} })
let mismatch = 0, symlinks = 0
time('read + git-blob-sha1 every tracked file in node', () => {
  for (const [p, oid] of idx) {
    const st = lstatSync(join(repo, p))
    if (st.isSymbolicLink()) { symlinks++; continue }
    const b = readFileSync(join(repo, p))
    const h = createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex')
    if (h !== oid) mismatch++
  }
})
console.log(`files=${idx.size} symlinks_skipped=${symlinks} node_hash_vs_index_mismatch=${mismatch}`)

const wt = '/tmp/squeal-probe-wt'
rmSync(wt, { recursive: true, force: true })
time('git worktree add --detach (checkout)', () => git(repo, 'worktree', 'add', '-q', '--detach', wt, 'HEAD'))
time('new worktree: git status --porcelain -z', () => git(wt, 'status', '--porcelain', '-z'))
const idx2 = time('new worktree: git ls-files -s -z', () => parseIndex(git(wt, 'ls-files', '-s', '-z')))
let same = 0; for (const [p, o] of idx) if (idx2.get(p) === o) same++
console.log(`new worktree oids identical to main: ${same}/${idx.size}`)
git(repo, 'worktree', 'remove', '--force', wt)

// Closure hash recompute: 5000 checks x 300-file closures, sorted (path, oid) lines.
const paths = [...idx.keys()]
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const closures = Array.from({ length: 5000 }, () =>
  [...new Set(Array.from({ length: 300 }, () => paths[Math.floor(rnd() * paths.length)]))].sort())
time('recompute 5000 closure hashes (~300 files each)', () => {
  for (const c of closures) {
    const h = createHash('sha256')
    for (const p of c) h.update(p).update('\0').update(idx.get(p)).update('\n')
    h.digest('hex')
  }
})
