// Usage: tsx mk-tree.ts <src root> <subject root> <commit>: makes the commit worktree, prints its tree.
const [src, root, commit] = process.argv.slice(2);
const { ensureCommitWorktree } = await import(`${src}/src/core/checkout/commit-worktree.ts`);
const w = await ensureCommitWorktree({ root, commit, note: (t: string) => console.error(t) });
console.log(w.tree);
process.exit(0);
