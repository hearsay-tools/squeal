// Throwaway (row 018-43): `squeal ci <args>` from this worktree's source, in the current directory.
import { ciCommand } from "/home/agent/projects/squeal/.ai/cezar/worktrees/37809bc6-27de-49d9-8d04-79dd3264b3f6/src/cli/ci.ts";
const write = (text: string) => process.stdout.write(text);
const code = await ciCommand(process.argv.slice(2), { stdout: write, stderr: write, cwd: process.cwd(), env: process.env });
process.exit(code);
