import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { piRun, transientProvider, debuggerWait } from '../scripts/adapters.ts';
import { diagnostics } from '../scripts/telemetry.ts';

const modelsConfig=join(import.meta.dirname,'..','models.json');
async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-worker-exit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const old={key:process.env.OPENROUTER_API_KEY,pi:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE,models:process.env.AMALEH_MODELS};
 // Other test files mutate AMALEH_MODELS concurrently, so pin the canonical file.
 process.env.OPENROUTER_API_KEY='sk-or-fake-diagnostic-secret-12345';process.env.AMALEH_MODELS=modelsConfig;
 t.after(()=>{for(const [name,value] of [['OPENROUTER_API_KEY',old.key],['AMALEH_PI_ENTRY',old.pi],['AMALEH_NODE',old.node],['AMALEH_MODELS',old.models]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;});
 return dir;
}
const assistant={type:'message_end',message:{role:'assistant',model:'test/model',content:[{type:'text',text:'Completed fixture'}],stopReason:'stop',usage:{input:10,output:3,cost:{total:.001}}}};
const emptyText={...assistant,message:{...assistant.message,content:[{type:'text',text:''}],usage:{input:10,output:0}}};
const lengthStop=(text:string)=>({...assistant,message:{...assistant.message,content:[{type:'text',text}],stopReason:'length'}});
const failed=(stopReason:string,errorMessage:string)=>({...assistant,message:{...assistant.message,stopReason,errorMessage}});
async function piFixture(t:any,source:string){const dir=await fixture(t),entry=join(dir,'fake-pi.ts');await writeFile(entry,source);process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;return {dir,input:{workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')}};}
const chunk=(items:unknown[])=>JSON.stringify(items.map(i=>JSON.stringify(i)).join('\n'));
// Logs each launch's pi arguments and counts launches, so a test can assert
// that the continuation ran in the same session via --continue.
const scriptedPi=(log:string,counter:string,first:unknown[],later:unknown[])=>`
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');
let n=0;try{n=Number(readFileSync(${JSON.stringify(counter)},'utf8'));}catch{}
writeFileSync(${JSON.stringify(counter)},String(n+1));
process.stdout.write(n===0?${chunk(first)}:${chunk(later)});
`;

test('a worker that finishes with agent_end but empty final text is recorded, not failed',async t=>{
 const {input}=await piFixture(t,`process.stdout.write(${chunk([emptyText,{type:'agent_end'}])});`);
 const result=await piRun(input);
 assert.equal(result.text,'','the empty summary is the recorded result');
 assert.equal(result.code,0);
 const report=await diagnostics(input.diagnosticRoot);
 assert.equal(report.totals.failures,0);
 assert.equal(report.operations[0].outcome,'success');
 await t.test('a reviewer call with empty text still fails, without burning retries',async st=>{
  const {input:reviewerInput}=await piFixture(st,`process.stdout.write(${chunk([emptyText,{type:'agent_end'}])});`);
  await assert.rejects(()=>piRun({...reviewerInput,readOnly:true}),/no final text for a reviewer/);
  const report=await diagnostics(reviewerInput.diagnosticRoot);
  assert.equal(report.totals.failures,1);
  assert.equal(report.operations[0].events.filter((e:any)=>e.stage==='attempt').length,1,'the text requirement is not a transient provider failure');
 });
});

test('a length stop continues the same pi session once and finishes there',async t=>{
 const dir=await fixture(t),entry=join(dir,'fake-pi.ts'),log=join(dir,'argv.jsonl'),counter=join(dir,'launches.txt');
 await writeFile(entry,scriptedPi(log,counter,[lengthStop('Partial work so far'),{type:'agent_end'}],[assistant,{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 const input={workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')};
 const result=await piRun(input);
 assert.equal(result.text,'Completed fixture','the continuation supplies the final answer');
 assert.equal(await readFile(join(dir,'launches.txt'),'utf8'),'2');
 const launches=(await readFile(join(dir,'argv.jsonl'),'utf8')).trim().split('\n').map((line:string)=>JSON.parse(line));
 assert.ok(!launches[0].includes('--continue'),'the first launch starts a fresh session');
 assert.ok(launches[1].includes('--continue'),'the continuation resumes the previous session');
 for(const argv of launches){
  assert.equal(argv[argv.indexOf('--session-dir')+1],input.sessionDir,'both launches share the session dir');
  assert.equal(argv[argv.indexOf('--model')+1],'test/model');
 }
 const report=await diagnostics(input.diagnosticRoot);
 assert.ok(report.operations[0].events.some((e:any)=>e.stage==='length-continue'),'the trace records the continuation');
 assert.equal(report.totals.failures,0);
});

test('a second length stop returns the partial result instead of throwing',async t=>{
 const dir=await fixture(t),entry=join(dir,'fake-pi.ts'),log=join(dir,'argv.jsonl'),counter=join(dir,'launches.txt');
 await writeFile(entry,scriptedPi(log,counter,[lengthStop('Part one'),{type:'agent_end'}],[lengthStop('Still incomplete'),{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 const input={workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')};
 const result=await piRun(input);
 assert.equal(result.text,'Still incomplete','the partial reply is returned, not discarded');
 assert.equal(await readFile(join(dir,'launches.txt'),'utf8'),'2','exactly one continuation was attempted');
 const report=await diagnostics(input.diagnosticRoot);
 assert.ok(report.operations[0].events.some((e:any)=>e.stage==='length-partial'),'the trace records the exhausted length budget');
 assert.equal(report.totals.failures,0);
});

test('an aborted run stays a provider error and is not continued',async t=>{
 const dir=await fixture(t),counter=join(dir,'launches.txt'),entry=join(dir,'fake-pi.ts');
 await writeFile(entry,scriptedPi(join(dir,'argv.jsonl'),counter,[failed('aborted','Operation aborted by the user'),{type:'agent_end'}],[assistant,{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 await assert.rejects(()=>piRun({workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')}),/aborted/);
 assert.equal(await readFile(counter,'utf8'),'1');
});

test('a command that waits for a debugger stops the call at once instead of idling until the timeout',{timeout:20000},async t=>{
 const debuggerWaits={type:'tool_execution_start',toolName:'bash',args:{command:`NODE_OPTIONS='--inspect-brk=9229' node -e "console.log(1)"`}};
 const {input}=await piFixture(t,`process.stdout.write(${chunk([debuggerWaits])}+'\\n');setInterval(()=>{},1000);`);
 const started=Date.now();
 await assert.rejects(()=>piRun({...input,idleTimeoutMs:600000}),/ran a command with --inspect-brk, which waits for a debugger/);
 assert.ok(Date.now()-started<15000,'the call must not wait for the idle timeout');
 const report=await diagnostics(input.diagnosticRoot);
 assert.ok(report.operations[0].events.some((e:any)=>e.stage==='debugger-wait'));
 assert.equal(report.operations[0].events.filter((e:any)=>e.stage==='attempt').length,1,'a debugger wait is not a transient provider failure');
});

test('only a JavaScript runtime started with a debugger-wait flag counts as a debugger wait',()=>{
 for(const command of ['node --inspect-brk scripts/check.mjs','bun test --inspect-wait','npx tsx --inspect-brk=9229 app.ts',
  `cd site && NODE_OPTIONS="--inspect-brk=0.0.0.0:9229" npm run build`,`NODE_OPTIONS='--max-old-space-size=4096 --inspect-brk' node app.js`,
  `$env:NODE_OPTIONS='--inspect-brk'; npm test`,`"/usr/bin/node" --inspect-brk app.js`,`& 'C:\\Program Files\\nodejs\\node.exe' --inspect-wait app.js`])
  assert.ok(debuggerWait(command),command);
 for(const command of ['node --inspect scripts/check.mjs',`rg -n -- '--inspect-brk' amaleh/scripts`,`rg -n "node --inspect-brk" .`,
  `echo "node --inspect-brk app.js"`,`grep -r 'NODE_OPTIONS' . && node app.js`,`rg -- '--inspect-brk' && node x.js`])
  assert.equal(debuggerWait(command),undefined,command);
 assert.equal(debuggerWait(undefined),undefined);
});

test('the first reason a call is stopped is the one reported, and the tree is killed once',{timeout:20000},async t=>{
 const debuggerWaits={type:'tool_execution_start',toolName:'bash',args:{command:'node --inspect-brk app.js'}};
 const turn={...assistant,message:{...assistant.message,stopReason:'toolUse'}};
 const {input}=await piFixture(t,`process.stdout.write(${chunk([debuggerWaits,turn])}+'\\n');setInterval(()=>{},1000);`);
 await assert.rejects(()=>piRun({...input,maxTurns:1,idleTimeoutMs:600000}),/--inspect-brk, which waits for a debugger/);
 const stages=(await diagnostics(input.diagnosticRoot)).operations[0].events.map((e:any)=>e.stage);
 assert.ok(stages.includes('debugger-wait'));
 assert.ok(!stages.includes('turn-limit'),'a later stop reason must not replace the first');
});

test('an empty provider response is transient and triggers failover',()=>{
 assert.equal(transientProvider('Provider returned an empty response'),true);
 assert.equal(transientProvider('502: Provider returned an empty response'),true);
 assert.equal(transientProvider('403: Your account lacks access to this model'),false);
});

test('a provider stream cut before its finish reason is transient and triggers failover',()=>{
 assert.equal(transientProvider('Stream ended without finish_reason'),true);
 assert.equal(transientProvider('Upstream error from Relace: The model stopped before completing the response.'),true);
});

test('a provider that returns an empty response is retried and recovers',async t=>{
 const dir=await fixture(t),counter=join(dir,'launches.txt'),entry=join(dir,'fake-pi.ts');
 await writeFile(entry,scriptedPi(join(dir,'argv.jsonl'),counter,[failed('error','Provider returned an empty response'),{type:'agent_end'}],[assistant,{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 const result=await piRun({workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')});
 assert.equal(result.text,'Completed fixture');
 assert.equal(await readFile(counter,'utf8'),'2');
 const report=await diagnostics(join(dir,'.diagnostics'));
 assert.equal(report.operations[0].events.filter((e:any)=>e.stage==='transient-provider').length,1);
 assert.equal(report.operations[0].outcome,'success');
});
