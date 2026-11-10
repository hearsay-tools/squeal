// Throwaway: inspect the error at the Vitest API boundary, outside Squeal.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadavg, cpus } from 'node:os';
const require = createRequire(resolve('package.json'));
const { createVitest } = await import(pathToFileURL(require.resolve('vitest/node')));
const root = resolve(process.argv[2]);
const gate = {at:new Date().toISOString(),load:loadavg()[0],cpus:cpus().length};
console.log(JSON.stringify({gate,version:require('vitest/package.json').version}));
if(gate.load>gate.cpus) process.exit(2);
process.chdir(root);
const consoleLogs=[];
const vitest=await createVitest('test',{root,watch:false,reporters:[{onUserConsoleLog(log){consoleLogs.push(log);}}]});
try {
 await vitest.standalone();
 const specs=await vitest.globTestSpecifications();
 await vitest.runTestSpecifications(specs);
 console.log('Unexpected success');
} catch(error) {
 console.log(JSON.stringify({name:error.name,message:error.message,stack:error.stack,cause:{name:error.cause?.name,message:error.cause?.message,code:error.cause?.code,stdout:error.cause?.stdout,stderr:error.cause?.stderr,stack:error.cause?.stack},consoleLogs},null,2));
} finally {await vitest.close();process.exitCode=0;}
