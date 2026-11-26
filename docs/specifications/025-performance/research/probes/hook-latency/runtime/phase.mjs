// Minimal preload: timestamp before import; bundle copy marks just before runMain.
import { writeFileSync } from 'node:fs';
const start=performance.now();
process.on('exit',()=>{
 const end=performance.now();
 writeFileSync(process.env.PROBE_LOG,JSON.stringify({start,loaded:globalThis.__sqLoaded,end,afterLoadMs:end-globalThis.__sqLoaded}));
});
