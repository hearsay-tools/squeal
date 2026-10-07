// Throwaway: summarise a hook log written by hook.sh, one line per hook run.
import { readFileSync } from 'node:fs';
for (const l of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const j = JSON.parse(l);
  console.log([j.label.padEnd(17), String(j.agent_id ?? 'main').slice(0, 8).padEnd(8), `pwd_P=${j.pwd_P}`, `PWD=${j.PWD}`,
    `stdin_cwd=${j.stdin_cwd}`, `CLAUDE_PROJECT_DIR=${j.env.CLAUDE_PROJECT_DIR ?? '-'}`, `| ${j.parent.slice(0, 70)}`].join(' '));
}
