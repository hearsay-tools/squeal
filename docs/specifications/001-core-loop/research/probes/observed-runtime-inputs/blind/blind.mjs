// THROWAWAY: which reads the recorder misses
import { globSync, promises as fsp } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
globSync('data/*.txt');                                  // fs.globSync: a listing
new DatabaseSync('data/db.sqlite').exec('create table if not exists t(x)');
new DatabaseSync('data/db.sqlite').prepare('select 1').get(); // native: sqlite opens the file itself
const fh = await fsp.open('data/fh.txt'); await fh.readFile(); await fh.close(); // FileHandle: open is seen
execSync('cat data/a.txt');                              // non-node child: only the spawn is seen
createRequire(import.meta.url)('./data/req.json');       // CJS require of JSON
