#!/usr/bin/env node
// Throwaway probe for 019-40. Not product code. Runs as squeal-e2e (as-e2e.mjs), read only.
//   node reports.mjs <clone> <stop file>
// Every 250 ms until <stop file> exists: the stored commit reports (store.sqlite meta
// `commit-reports:*`), the told marks (`commit-told:*`), and the lint keying and cursor
// (lint.sqlite). Prints one JSON line with epoch ms each time one of them changes.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const [clone, stop] = process.argv.slice(2);
const open = (name) => {
  try {
    return new DatabaseSync(`${clone}/.git/squeal/${name}`, { readOnly: true });
  } catch {
    return null;
  }
};
const read = (db, like) => {
  try {
    return db?.prepare("SELECT key, value FROM meta WHERE key LIKE ?").all(like).map((r) => r.value) ?? [];
  } catch {
    return [];
  }
};
let store = null;
let lint = null;
let last = "";
while (!existsSync(stop)) {
  store ??= open("store.sqlite");
  lint ??= open("lint.sqlite");
  const now = JSON.stringify({
    reports: read(store, "commit-reports:%"),
    told: read(store, "commit-told:%"),
    keying: read(lint, "lint-keying:%"),
    cursor: read(lint, "lint-cursor:%"),
  });
  if (now !== last) {
    console.log(JSON.stringify({ at: Date.now(), ...JSON.parse(now) }));
    last = now;
  }
  await sleep(250);
}
