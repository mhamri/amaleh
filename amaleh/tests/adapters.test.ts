import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { piRun, requestJson, guidanceBlock, handoffFile, reviewReport, promptLimit, transientProvider, trackedContent } from '../scripts/adapters.ts';
import { Store } from '../scripts/core.ts';
import { jsRuntime, onPath } from '../scripts/runtime.ts';
import { diagnostics, trace, readSpeedSamples } from '../scripts/telemetry.ts';
import { main } from '../scripts/cli.ts';

async function fixture(t:any){const dir=await mkdtemp(join(tmpdir(),'amaleh-adapter-'));t.after(()=>rm(dir,{recursive:true,force:true}));const old={key:process.env.OPENROUTER_API_KEY,pi:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};process.env.OPENROUTER_API_KEY='sk-or-fake-diagnostic-secret-12345';t.after(()=>{for(const [name,value] of [['OPENROUTER_API_KEY',old.key],['AMALEH_PI_ENTRY',old.pi],['AMALEH_NODE',old.node]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;});return dir;}
const assistant={type:'message_end',message:{role:'assistant',model:'test/model',content:[{type:'text',text:'Completed fixture'}],stopReason:'stop',usage:{input:10,output:3,cost:{total:.001}}}};
async function piFixture(t:any,source:string){const dir=await fixture(t),entry=join(dir,'fake-pi.ts');await writeFile(entry,source);process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;return {dir,input:{workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')}};}
const output=(items:unknown[])=>`process.stdout.write(${JSON.stringify(items.map(i=>JSON.stringify(i)).join('\n'))});`;

test('OpenRouter terminal status errors retain diagnostics without leaking credentials',async t=>{const dir=await fixture(t);for(const status of [400,401,402,403]){let calls=0;await assert.rejects(()=>requestJson('https://openrouter.ai/api/alpha/decisions',{},(async()=>{calls++;return new Response('{}',{status});}) as typeof fetch,dir),new RegExp(String(status)));assert.equal(calls,1);}const report=await diagnostics(dir);assert.equal(report.totals.failures,4);assert.ok(!JSON.stringify(report).includes(process.env.OPENROUTER_API_KEY!));});
test('retry status and usage are retained on eventual API success',async t=>{const dir=await fixture(t);let calls=0;const value=await requestJson('https://openrouter.ai/api/alpha/decisions',{},(async()=>++calls===1?new Response('{}',{status:429,headers:{'retry-after':'0.001'}}):Response.json({model:'jev',usage:{input_tokens:12,output_tokens:2,cost:.0001}})) as typeof fetch,dir);assert.equal(value.model,'jev');assert.equal(calls,2);const d=await diagnostics(dir);assert.equal(d.totals.inputTokens,12);assert.equal(d.totals.reportedCost,.0001);assert.equal(d.operations[0].events.filter((e:any)=>e.stage==='attempt').length,2);});
test('transport exhaustion and malformed success JSON are diagnosed',async t=>{const dir=await fixture(t);let calls=0;await assert.rejects(()=>requestJson('https://openrouter.ai/api/alpha/decisions',{},(async()=>{calls++;throw new Error('network '+process.env.OPENROUTER_API_KEY);}) as typeof fetch,dir),/bounded retries/);assert.equal(calls,3);await assert.rejects(()=>requestJson('https://openrouter.ai/api/alpha/decisions',{},(async()=>new Response('not JSON',{status:200})) as typeof fetch,dir));const report=await diagnostics(dir);assert.equal(report.totals.failures,2);assert.ok(!JSON.stringify(report).includes(process.env.OPENROUTER_API_KEY!));});
test('pi parses a final JSONL record without newline and records usage',async t=>{const {input}=await piFixture(t,output([assistant,{type:'agent_end'}]));const result=await piRun(input);assert.equal(result.text,'Completed fixture');const d=await diagnostics(input.diagnosticRoot);assert.equal(d.totals.inputTokens,10);assert.equal(d.totals.outputTokens,3);assert.equal(d.totals.estimatedCost,.001);assert.equal(d.totals.reportedCost,0);assert.equal(d.operations[0].outcome,'success');});
test('pi rejects incomplete, malformed, mismatched and failed response streams',async t=>{for(const [label,source] of [
 ['incomplete',output([assistant])],
 ['content-shape',output([{...assistant,message:{...assistant.message,content:{}}},{type:'agent_end'}])],
 ['content-null',output([{...assistant,message:{...assistant.message,content:[null]}},{type:'agent_end'}])],
 ['malformed',output([assistant,{type:'agent_end'}])+"process.stdout.write('\\ninvalid');"],
 ['model',output([{...assistant,message:{...assistant.message,model:'other/model'}},{type:'agent_end'}])],
 ['provider',output([{...assistant,message:{...assistant.message,stopReason:'error',errorMessage:'bad request'}},{type:'agent_end'}])]
]){await t.test(label,async st=>{const {input}=await piFixture(st,source);await assert.rejects(()=>piRun(input));assert.equal((await diagnostics(input.diagnosticRoot)).totals.failures,1);});}});
test('pi rejects spawn and ownership failures without leaving promises unresolved',async t=>{const {dir,input}=await piFixture(t,`setTimeout(()=>{},10000);`);process.env.AMALEH_NODE=join(dir,'missing-node');await assert.rejects(()=>piRun(input),{code:"ENOENT"});const failed=await diagnostics(input.diagnosticRoot);assert.equal(failed.totals.failures,1);assert.equal(failed.totals.unfinished,0);assert.equal(failed.operations[0].events.at(-1)?.stage,"finished");process.env.AMALEH_NODE=process.execPath;await assert.rejects(()=>piRun({...input,onSpawn:async()=>{throw new Error('owner checkpoint failed');}}),/owner checkpoint/);});
test('failed CLI initialization remains diagnosable without a valid run snapshot',async t=>{const dir=await fixture(t),request=join(dir,'request.json');await writeFile(request,'{}');await assert.rejects(()=>main(['start',dir,'failed',request]));const report=await main(['diagnose',dir,'failed']) as any;assert.ok(report.stateError);assert.equal(report.diagnostics.totals.failures,1);});
test('unfinished traces remain visible after a simulated interrupted operation',async t=>{const dir=await fixture(t);await trace(dir,'interrupted',{task:'x'});const report=await diagnostics(dir);assert.equal(report.totals.unfinished,1);assert.match(report.operations[0].outcome,/active or interrupted/);});
const rateLimited={...assistant,message:{...assistant.message,stopReason:'error',errorMessage:'429: {"message":"Provider returned error","code":429,"metadata":{"raw":"z-ai/glm-5.3-flashx is temporarily rate-limited upstream."}}'}};
const refused={...assistant,message:{...assistant.message,stopReason:'error',errorMessage:'403: {"message":"Your account lacks access to this model","code":403}'}};
const flakyPi=(counter:string,first:unknown[],later:unknown[])=>
 `import {readFileSync,writeFileSync} from 'node:fs';\nconst path=${JSON.stringify(counter)};\nlet n=0;try{n=Number(readFileSync(path,'utf8'));}catch{}\nwriteFileSync(path,String(n+1));\nif(n===0){${output(first)}}else{${output(later)}}\n`;
test('a transient provider rate limit is retried instead of blocking the chunk',async t=>{
 const dir=await fixture(t),counter=join(dir,'attempts.txt'),entry=join(dir,'fake-pi.ts');
 await writeFile(entry,flakyPi(counter,[rateLimited,{type:'agent_end'}],[assistant,{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 const result=await piRun({workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')});
 assert.equal(result.text,'Completed fixture');
 assert.equal(await readFile(counter,'utf8'),'2');
 const report=await diagnostics(join(dir,'.diagnostics'));
 assert.equal(report.operations[0].outcome,'success');
 assert.equal(report.operations[0].events.filter((e:any)=>e.stage==='transient-provider').length,1);
});
test('a non-transient provider refusal fails on the first attempt',async t=>{
 const dir=await fixture(t),counter=join(dir,'attempts.txt'),entry=join(dir,'fake-pi.ts');
 await writeFile(entry,flakyPi(counter,[refused,{type:'agent_end'}],[assistant,{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 await assert.rejects(()=>piRun({workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')}),/403/);
 assert.equal(await readFile(counter,'utf8'),'1');
});
test('an exhausted retry budget still surfaces the provider message',async t=>{
 const dir=await fixture(t),counter=join(dir,'attempts.txt'),entry=join(dir,'fake-pi.ts');
 await writeFile(entry,flakyPi(counter,[rateLimited,{type:'agent_end'}],[rateLimited,{type:'agent_end'}]));
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 await assert.rejects(()=>piRun({workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics'),attempts:2}),/rate-limited/);
 assert.equal(await readFile(counter,'utf8'),'2');
});
test('transient provider trouble is retried; a settled money or access failure is not',()=>{
 const transient=[
  'Network connection lost.',
  'OpenRouter could not verify available credits for this request in time. Retry shortly.',
  '429: {"message":"Provider returned error","metadata":{"raw":"temporarily rate-limited upstream"}}',
  '503: Service temporarily unavailable',
  'fetch failed: ECONNRESET',
  'Upstream timed out, try again shortly'];
 const settled=[
  'OpenRouter HTTP 402: credits exhausted; top up and resume',
  'Your account lacks access to this model',
  '401 unauthorized: invalid api key',
  'insufficient credit balance',
  'pi resolved a different model (other/model); update the task route explicitly',
  'Reviewer did not return a JSON report object; re-request the exact output shape'];
 for(const message of transient)assert.equal(transientProvider(message),true,'must retry: '+message);
 for(const message of settled)assert.equal(transientProvider(message),false,'must not retry: '+message);
});
test('a large brief reaches the worker as a path, never inlined past the command-line limit',async t=>{
 const dir=await fixture(t),store=new Store(dir,'guided');
 const body='y'.repeat(40000);
 const path=await handoffFile(store,'a','brief.md',body);
 assert.ok(path.length<200,`the prompt carries only the path, which is ${path.length} characters`);
 assert.equal(path,join(store.root,'sessions','a','brief.md'));
 assert.equal(await readFile(path,'utf8'),body,'the whole payload must reach the file');
 assert.ok(!path.startsWith(dir+'\\a\\'),'the handoff must not land inside the task workspace');
});
test('a hung child is killed and reported instead of blocking the chunk forever',async t=>{
 const {input}=await piFixture(t,`setInterval(()=>{},1000);`);
 const started=Date.now();
 await assert.rejects(()=>piRun({...input,idleTimeoutMs:600}),/No output for \d+s; a child command is hung/);
 assert.ok(Date.now()-started<20000,'the timeout must fire promptly, not wait for the process to end on its own');
 const report=await diagnostics(input.diagnosticRoot);
 assert.equal(report.totals.failures,1,'a hung launch must be recorded as a failure, not left unfinished');
 assert.equal(report.totals.unfinished,0);
 assert.ok(report.operations[0].events.some((e:any)=>e.stage==='idle-timeout'),'the trace must name the idle timeout');
});
test('a worker that keeps producing output is never cut off by the idle timeout',async t=>{
 const {input}=await piFixture(t,`let n=0;const t=setInterval(()=>{process.stdout.write(JSON.stringify({type:'tool_execution_start',toolName:'bash'})+'\\n');if(++n===6){clearInterval(t);${output([assistant,{type:'agent_end'}])}}},120);`);
 const result=await piRun({...input,idleTimeoutMs:600});
 assert.equal(result.text,'Completed fixture','steady progress must keep the worker alive past the idle window');
});
test('a finished call adds one speed sample, and a first read seeds the ledger from earlier run traces',async t=>{
 const {dir,input}=await piFixture(t,output([assistant,{type:'agent_end'}]));
 const amalehDir=join(dir,'.amaleh'),earlier=join(amalehDir,'runs','earlier');
 const old=await trace(earlier,'pi',{model:'old/model',readOnly:true});await old.write('usage',{outputTokens:500});await old.end('success');
 await piRun({...input,speedDir:amalehDir,readOnly:false});
 await piRun({...input,speedDir:amalehDir,readOnly:true});
 const samples=await readSpeedSamples(amalehDir);
 assert.deepEqual(samples.map(s=>[s.model,s.role,s.outputTokens]),[['old/model','reviewer',500],['test/model','worker',3],['test/model','reviewer',3]]);
 assert.ok(samples.every(s=>s.ms>=0&&!Number.isNaN(Date.parse(s.at))));
 await writeFile(join(amalehDir,'model-speed.jsonl'),(await readFile(join(amalehDir,'model-speed.jsonl'),'utf8'))+'not json\n{"model":"x"}\n');
 assert.equal((await readSpeedSamples(amalehDir)).length,3,'a torn or foreign line is skipped, not fatal');
});
test('an oversized prompt is refused with a message naming the limit',async t=>{
 const {input}=await piFixture(t,output([assistant,{type:'agent_end'}]));
 await assert.rejects(()=>piRun({...input,prompt:'y'.repeat(promptLimit+1)}),new RegExp(`cannot carry more than ${promptLimit}`));
});
test('a review report survives the wrappers flash models put around JSON',()=>{
 const report={report:'Inspected slugify.ts',coverage:[{id:'criterion:1',status:'covered',evidence:'ran the spec'}],findings:[]};
 const body=JSON.stringify(report);
 const wrappers=[body,'```json\n'+body+'\n```','```\n'+body+'\n```','Here is my review:\n'+body,
  body+'\n\nLet me know if you want more detail.','Sure! '+body+' Done.',
  'Thinking about {braces} in prose first.\n'+body];
 for(const text of wrappers)assert.deepEqual(reviewReport(text),report,text.slice(0,40));
});
test('a report with a brace inside a string value is not cut short',()=>{
 const report={report:'The literal "{" appears in the source',coverage:[{id:'criterion:1',status:'covered',evidence:'saw a } here'}],findings:[]};
 assert.deepEqual(reviewReport('Review follows.\n'+JSON.stringify(report)),report);
});
test('prose with no JSON object is rejected, and malformed coverage reaches the coverage check',()=>{
 assert.throws(()=>reviewReport('I could not complete the review.'),/did not return a JSON report object/);
 assert.throws(()=>reviewReport('```json\n[1,2,3]\n```'),/did not return a JSON report object/);
 assert.deepEqual(reviewReport('{"report":"no coverage key"}'),{report:'no coverage key'});
});
test('guidance files are inlined into the worker brief with their resolved path',async t=>{const dir=await fixture(t);await writeFile(join(dir,'taste.md'),'Spend boldness in one place.');await writeFile(join(dir,'contract.md'),'Every route prerenders.');const block=await guidanceBlock(dir,{skills:['taste.md'],references:['contract.md']});assert.match(block,/SKILL: taste\.md/);assert.match(block,/Spend boldness in one place\./);assert.match(block,/REFERENCE: contract\.md/);assert.match(block,/Every route prerenders\./);assert.ok(block.includes(join(dir,'taste.md')));assert.equal(await guidanceBlock(dir,{}),'');});
test('an unreadable guidance entry fails loudly and names every path it searched',async t=>{const dir=await fixture(t);await assert.rejects(()=>guidanceBlock(dir,{skills:['./missing.md']}),/was not readable; searched/);await assert.rejects(()=>guidanceBlock(dir,{skills:['no-such-skill-installed-anywhere']}),/SKILL\.md/);await assert.rejects(()=>guidanceBlock(dir,{skills:['']}),/non-empty strings/);await assert.rejects(()=>guidanceBlock(dir,{references:'contract.md' as unknown as string[]}),/must be an array/);});
test('a bare skill name resolves to SKILL.md under an installed skills root',async t=>{const dir=await fixture(t),home=await mkdtemp(join(tmpdir(),'amaleh-codex-')),old=process.env.CODEX_HOME;t.after(()=>{if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;return rm(home,{recursive:true,force:true});});process.env.CODEX_HOME=home;await mkdir(join(home,'skills','taste-bar'),{recursive:true});await writeFile(join(home,'skills','taste-bar','SKILL.md'),'One bold surface, disciplined surroundings.');const block=await guidanceBlock(dir,{skills:['taste-bar']});assert.match(block,/SKILL: taste-bar/);assert.match(block,/One bold surface, disciplined surroundings\./);});
test('oversized guidance is truncated at the stated limit instead of flooding the worker',async t=>{const dir=await fixture(t);await writeFile(join(dir,'huge.md'),'x'.repeat(500));const block=await guidanceBlock(dir,{skills:['huge.md']},100);assert.match(block,/\[truncated at 100 characters\]/);assert.ok(block.length<400);});
test('runtime resolution prefers explicit overrides, then bun, then the running executable',async t=>{const old={runtime:process.env.AMALEH_RUNTIME,node:process.env.AMALEH_NODE,path:process.env.PATH};t.after(()=>{for(const [name,value] of [['AMALEH_RUNTIME',old.runtime],['AMALEH_NODE',old.node],['PATH',old.path]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;});
 delete process.env.AMALEH_NODE;process.env.AMALEH_RUNTIME='/explicit/runtime';assert.equal(await jsRuntime(),'/explicit/runtime');
 delete process.env.AMALEH_RUNTIME;process.env.AMALEH_NODE='/legacy/node';assert.equal(await jsRuntime(),'/legacy/node');
 delete process.env.AMALEH_NODE;assert.match(await jsRuntime(),/bun/);
 process.env.PATH='';assert.equal(await jsRuntime(),process.execPath);
 assert.equal(await onPath('definitely-not-an-installed-executable'),undefined);});

test('tracked content changes when an untracked link points somewhere else, even at identical bytes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-tracked-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync('git',['init','-q'],{cwd:dir});
 await writeFile(join(dir,'a.txt'),'same');await writeFile(join(dir,'b.txt'),'same');
 try{await symlink('a.txt',join(dir,'link'));}catch(e){t.skip(`this machine cannot create a symbolic link: ${(e as Error).message}`);return;}
 const before=await trackedContent(dir);
 await rm(join(dir,'link'));await symlink('b.txt',join(dir,'link'));
 assert.notEqual(await trackedContent(dir),before);
});
