import { readFileSync } from 'node:fs';
readFileSync(new URL('../data/grand.txt', import.meta.url), 'utf8');
