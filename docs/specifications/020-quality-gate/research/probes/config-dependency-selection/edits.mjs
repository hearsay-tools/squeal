// Throwaway (row 020-42). Each edit changes one config dependency of the fixture.
// `node edits.mjs <repo> <name>` applies one; `node edits.mjs <repo> --list` lists them.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const EDITS = {
  define: ['config/define-value.mjs', "'on'", "'off'"],
  plugin: ['config/plugin.mjs', '"one"', '"two"'],
  side: ['config/side-effect.mjs', "'a'", "'b'"],
  sort: ['config/order.mjs', 'a < b ? -1 : a > b ? 1 : 0', 'a < b ? 1 : a > b ? -1 : 0'],
  shard: ['config/sequencer.mjs', 'i % count === index - 1', '(i + 1) % count === index % count'],
  reporter: ['config/reporter.mjs', 'onTestRunEnd() {}', "onTestRunEnd() { throw new Error('reporter edit') }"],
  stringReporter: ['config/string-reporter.mjs', 'onTestRunEnd() {}', "onTestRunEnd() { throw new Error('string reporter edit') }"],
  importedJson: ['config/imported.json', '"d1"', '"d2"'],
  fsJson: ['config/weights.json', '1', '2'],
}

const [repo, name] = process.argv.slice(2)
if (repo && name === '--list') console.log(Object.keys(EDITS).join(' '))
else if (repo && name) {
  const [file, from, to] = EDITS[name]
  const path = join(repo, file)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(from)) throw new Error(`${name}: ${from} not in ${file}`)
  writeFileSync(path, text.replace(from, to))
}
