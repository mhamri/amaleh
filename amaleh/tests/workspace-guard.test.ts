import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { piRun, resolveWrites, workerPrompt, nestedRunCheckout, WorkspaceEscape } from '../scripts/adapters.ts';
import * as c from '../scripts/core.ts';
import { delegate } from '../scripts/delegate.ts';
import { fixtureClaim, clearCut } from './execution-fixture.ts';

const assistant={type:'message_end',message:{role:'assistant',model:'test/model',content:[{type:'text',text:'Completed fixture'}],stopReason:'stop',usage:{input:10,output:3,cost:{total:.001}}}};
// Other test files point AMALEH_MODELS at deleted temp dirs; pin the shared suite env to the real configuration.
const repoModels=join(dirname(fileURLToPath(import.meta.url)),'..','models.json');
const keepModels=(t:any)=>{const old=process.env.AMALEH_MODELS;process.env.AMALEH_MODELS=repoModels;t.after(()=>{if(old===undefined)delete process.env.AMALEH_MODELS;else process.env.AMALEH_MODELS=old;});};
const output=(items:unknown[])=>`process.stdout.write(${JSON.stringify(items.map(i=>JSON.stringify(i)).join('\n'))});`;
const tool=(name:string,args:unknown)=>({type:'tool_execution_start',toolCallId:'c1',toolName:name,args});

async function piFixture(t:any,makeSource:(dir:string)=>string){
 keepModels(t);
 const dir=await mkdtemp(join(tmpdir(),'amaleh-guard-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const entry=join(dir,'fake-pi.ts');await writeFile(entry,makeSource(dir));
 const old={key:process.env.OPENROUTER_API_KEY,pi:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 process.env.OPENROUTER_API_KEY='sk-or-fake-diagnostic-secret-12345';process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 t.after(()=>{for(const [name,value] of [['OPENROUTER_API_KEY',old.key],['AMALEH_PI_ENTRY',old.pi],['AMALEH_NODE',old.node]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;});
 return {dir,input:{workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics')}};
}

test('an edit or write outside the workspace kills the worker and fails the run at once',async t=>{
 const {input}=await piFixture(t,dir=>output([
  tool('edit',{path:join(dir,'src','a.ts')}),
  tool('edit',{path:join(tmpdir(),'elsewhere','leak.ts')}),
  tool('write',{path:join(tmpdir(),'elsewhere','second-leak.md')}),
  tool('bash',{command:'rm -rf /'}),
  {type:'tool_execution_end',toolCallId:'c1',toolName:'edit',isError:false},
  assistant,{type:'agent_end'}])+';setInterval(()=>{},1000);');
 // The fake pi stays alive after printing its events, so only the guard's killTree can end the run before the generous idle timeout.
 const error=await piRun({...input,idleTimeoutMs:60000}).then(()=>undefined,(e:Error)=>e);
 assert.ok(error,'piRun must reject when a write escapes the workspace');
 assert.match(error.message,/Worker wrote outside the task workspace/);
 assert.ok(error.message.includes(resolve(tmpdir(),'elsewhere','leak.ts')),'the error names the first escaped path');
 assert.ok(error.message.includes(resolve(tmpdir(),'elsewhere','second-leak.md')),'the error names every escaped path');
});

test('a worker whose writes all stay inside passes the guard',async t=>{
 const {dir,input}=await piFixture(t,dir=>output([
  tool('write',{path:'ok.md'}),
  tool('edit',{path:join(dir,'nested','b.ts')}),
  tool('bash',{command:'rm -rf /'}),
  assistant,{type:'agent_end'}]));
 const result=await piRun(input);
 assert.deepEqual(result.writes.outside,[]);
 assert.deepEqual(result.writes.paths,[resolve(dir,'ok.md'),resolve(dir,'nested','b.ts')],'only edit and write calls are collected; bash is not a write path');
});

test('resolveWrites flags traversal, foreign roots and drops unusable paths',()=>{
 const root=join(tmpdir(),'workspace-root');
 const {paths,outside}=resolveWrites(root,['a.md',join(root,'..','outside.md'),join(root,'sub','x.md'),join(tmpdir(),'other','y.md'),'   ',undefined]);
 assert.deepEqual(outside,[resolve(root,'..','outside.md'),resolve(tmpdir(),'other','y.md')]);
 assert.deepEqual(paths,[join(root,'a.md'),resolve(root,'..','outside.md'),join(root,'sub','x.md'),resolve(tmpdir(),'other','y.md')]);
});

const promptInput=()=>({workspace:join(tmpdir(),'task-checkout'),briefPath:join(tmpdir(),'run','sessions','task','brief.md'),artifacts:join(tmpdir(),'run','artifacts'),runtime:process.execPath,jev:join(tmpdir(),'amaleh','scripts','jev.ts'),question:join(tmpdir(),'amaleh','scripts','question.ts'),runWorkspace:join(tmpdir(),'main-checkout'),runId:'run-id',taskId:'task-id'});
test('the worker prompt names the task workspace and the read-only handoff paths',()=>{
 const input=promptInput(),prompt=workerPrompt(input);
 assert.ok(prompt.includes(input.workspace));
 assert.match(prompt,/Every edit and write must stay under/);
 for(const path of [input.briefPath,input.artifacts,input.jev,input.question,input.runWorkspace]){assert.ok(prompt.includes(path),path+' must be named');assert.match(prompt,/read-only/,path+' must be marked read-only');}
});
test('the worker prompt routes a wrong contract to a question, forbids vendor code from memory and commands that never end',()=>{
 const input=promptInput(),prompt=workerPrompt(input);
 assert.ok(prompt.includes(`"${input.runtime}" "${input.question}" "${input.runWorkspace}" run-id task-id`),'the contract question command names the run, not the task checkout');
 assert.match(prompt,/do not bend the work to fit it/);
 assert.match(prompt,/Never write vendor code or setup for a third-party service from memory/);
 assert.match(prompt,/--inspect-brk/);
 assert.match(prompt,/\/dev\/null; NUL creates a file/);
});

test('the worker prompt stays true when the task workspace sits inside the run checkout',()=>{
 const base=promptInput(),workspace=join(base.runWorkspace,'.amaleh','worktrees','run-id','task-id');
 assert.equal(nestedRunCheckout(base.runWorkspace,workspace),true);
 assert.equal(nestedRunCheckout(base.runWorkspace,join(tmpdir(),'elsewhere')),false);
 assert.equal(nestedRunCheckout(base.runWorkspace,base.runWorkspace),false,'the run checkout itself is not a nested workspace');
 const nested=workerPrompt({...base,workspace,nested:true});
 assert.match(nested,/Every edit and write must stay under/);
 assert.match(nested,/contains this task workspace/);
 assert.match(nested,/sit outside this workspace as read-only run records/);
 assert.ok(nested.includes(base.briefPath)&&nested.includes(base.runWorkspace),'the brief and the main checkout are still named');
 assert.doesNotMatch(nested,/and the run's main checkout at .* sit outside it and are read-only/,'a checkout containing the task workspace is never declared read-only as a whole');
 assert.match(workerPrompt({...base,workspace,nested:false}),/and the run's main checkout at .* sit outside it and are read-only/);
});

const task=(id:string,deps:string[]=[])=>({id,title:id,goal:'Correct observable behavior',phase:'checkout',deps,resources:[id],criteria:['correct result'],kind:'code' as const,checks:[{id:'test',command:process.execPath,args:['-e','process.exit(0)'],role:'guard'}],noProbe:'Test fixture; workspace confinement is asserted by the test, not by an executable probe'} as c.Task);
const jevTargeted=(async()=>Response.json({model:'test/jev',answers:{selection:{type:'choice',choice:'targeted',confidence:.95,probabilities:{targeted:.95,rethink:.03,simplify:.02}}}})) as typeof fetch;
async function delegateFixture(t:any,tasks:c.Task[]=[task('a')]){
 keepModels(t);
 const dir=await mkdtemp(join(tmpdir(),'amaleh-guard-delegate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'app.txt'),'original');
 const oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='sk-delegate-fixture-not-real';t.after(()=>{if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
 const store=await c.start(dir,{shape:clearCut,id:'guard',host:{kind:'codex',model:'gpt-6-astra'},intent:'Correct charge amount',criteria:['Correct amount charged']});
 await c.plan(store,{tasks,integrationChecks:[]});
 return {dir,store};
}
async function syntheticCoverage(store:c.Store,id:string){const state=await store.load();return c.reviewObligations(state,c.taskOf(state,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic protocol fixture only; not a real model review'}));}
const fakeReviewer=(dir:string)=>async (store:c.Store,id:string)=>{await c.review(store,id,{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(dir),findings:[],report:'Synthetic fixture review',coverage:await syntheticCoverage(store,id)});return {findings:[]};};
const cleanWorker=(dir:string)=>async(store:c.Store,id:string,input:{workspace?:string})=>{
 await fixtureClaim(store,id,{workspace:input.workspace??dir,model:'deepseek/flash'});
 await c.result(store,id,{changed:'app.txt',writes:{paths:[join(dir,'app.txt')],outside:[]}});
 return {artifact:c.taskOf(await store.load(),id).output};};
const escapingWorker=(dir:string,escaped:string[])=>async(store:c.Store,id:string,input:{workspace?:string})=>{
 await fixtureClaim(store,id,{workspace:input.workspace??dir,model:'deepseek/flash'});
 const escape=new WorkspaceEscape(escaped);
 await store.transaction(s=>{const t=c.taskOf(s,id);t.status='blocked';t.owner=undefined;t.blocked=escape.message;});
 throw escape;};

test('an escaped write escalates with stage workspace-escape and leaves the task blocked for the host',async t=>{
 const {dir,store}=await delegateFixture(t);
 const escaped=[join(tmpdir(),'elsewhere','leak.ts')];
 const out=await delegate(store,'a',{workspace:dir},{runWorker:escapingWorker(dir,escaped) as any,runReviewer:fakeReviewer(dir) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'escalated');
 assert.equal(out.stage,'workspace-escape');
 assert.deepEqual(out.escaped,escaped);
 assert.match(String(out.reason),/Worker wrote outside the task workspace/);
 assert.ok(out.trail.some(s=>s.stage==='worker'));
 assert.ok(!out.trail.some(s=>s.stage==='provider-failover'),'an escape spends no provider failover');
 const after=c.taskOf(await store.load(),'a');
 assert.equal(after.cycles,0,'an escape spends no repair cycle');
 assert.equal(after.status,'blocked','the host restores the escaped files and requeues a blocked task');
 assert.ok(after.blocked!.includes(escaped[0]),'the blocked reason names the escaped path');
});

test('an escape during a repair run escalates without another repair cycle or failover',async t=>{
 const failingCheck:c.Task['checks'][number]={id:'test',command:process.execPath,args:['-e','process.exit(1)'],role:'probe'};
 const {dir,store}=await delegateFixture(t,[{...task('a'),checks:[failingCheck]}]);
 const escaped=[join(tmpdir(),'elsewhere','repair-leak.ts')];
 const workers=[cleanWorker(dir),escapingWorker(dir,escaped)];let call=0;
 const sequenced=(store:c.Store,id:string,input:{workspace?:string})=>workers[Math.min(call++,workers.length-1)](store,id,input);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:sequenced as any,runReviewer:fakeReviewer(dir) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'escalated');
 assert.equal(out.stage,'workspace-escape');
 assert.deepEqual(out.escaped,escaped);
 assert.ok(!out.trail.some(s=>s.stage==='provider-failover'),'an escape spends no provider failover');
 const after=c.taskOf(await store.load(),'a');
 assert.equal(after.cycles,1,'the failing check spent one repair cycle; the escape itself spends none');
 assert.equal(after.status,'blocked');
});

test('a worker whose writes all stay inside is accepted',async t=>{
 const {dir,store}=await delegateFixture(t);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:cleanWorker(dir) as any,runReviewer:fakeReviewer(dir) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted');
 assert.ok(!out.trail.some(s=>s.stage==='workspace'),'a clean run carries no violation stage');
});

test('a registered check may use any id without conflict',async t=>{
 const {store}=await delegateFixture(t);
 await assert.doesNotReject(()=>c.plan(store,{tasks:[task('a'),{...task('b'),checks:[{id:'my-check',command:'x',args:[],role:'guard'}]}],integrationChecks:[]}));
});
