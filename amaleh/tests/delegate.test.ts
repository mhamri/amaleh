import {fixtureClaim,clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { delegate, delegateBatch, waitForDelegations } from '../scripts/delegate.ts';
import { trace, modelSpeed, slowModels, speedSamples } from '../scripts/telemetry.ts';
import { hostname } from 'node:os';
import { loadModelConfig } from '../scripts/config.ts';
import { main } from '../scripts/cli.ts';
import { decideBatch } from '../scripts/adapters.ts';
import { jevAsk } from '../scripts/jev.ts';
import { processHealth, coordinatorOperationCount } from '../scripts/host-diagnostics.ts';

const task=(id:string,deps:string[]=[])=>({id,title:id,goal:'Correct observable behavior',phase:'checkout',deps,resources:[id],criteria:['correct result'],kind:'code' as const,checks:[{id:'test',command:process.execPath,args:['-e',"try{const c=require('fs').readFileSync(require('path').join(process.cwd(),'app.txt'),'utf8');process.exit(c.includes('original')?1:0)}catch{process.exit(1)}"],role:'probe' as const}]} as c.Task);
async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-delegate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'app.txt'),'original');
 const oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='sk-delegate-fixture-not-real';t.after(()=>{if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
 const store=await c.start(dir,{shape:clearCut,id:'deleg',host:{kind:'codex',model:'gpt-6-astra'},intent:'Correct charge amount',criteria:['Correct amount charged']});
 await c.plan(store,{tasks:[task('a')],integrationChecks:[]});
 return {dir,store};
}
async function syntheticCoverage(store:c.Store,id:string){const state=await store.load();return c.reviewObligations(state,c.taskOf(state,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic protocol fixture only; not a real model review'}));}
const blocking=[{id:'wrong',lens:'Spec',location:'app.txt',scenario:'charges 11 instead of 10',evidence:'observed expected-versus-actual',consequence:'overcharge',blocking:true}];
const fakeWorker=(dir:string,counter?:{n:number})=>async (store:any,id:string,input:any)=>{if(counter)counter.n++;await fixtureClaim(store,id,{workspace:input.workspace??dir,model:'deepseek/flash'});writeFileSync(join(input.workspace??dir,'app.txt'),'corrected');await c.result(store,id,{changed:'app.txt'});return {artifact:c.taskOf(await store.load(),id).output};};
const fakeReviewer=(dir:string,script:any[][])=>{let call=0;return async (store:any,id:string)=>{const findings=script[Math.min(call++,script.length-1)];await c.review(store,id,{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(dir),findings,report:'Synthetic fixture review',coverage:await syntheticCoverage(store,id)});return {findings};};};
const jevTargeted=(async()=>Response.json({model:'test/jev',answers:{selection:{type:'choice',choice:'targeted',confidence:.95,probabilities:{targeted:.95,rethink:.03,simplify:.02}}}})) as typeof fetch;

test('a clean chunk is accepted end to end without coordinator involvement',async t=>{
 const {dir,store}=await fixture(t);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted');
 assert.equal(c.taskOf(await store.load(),'a').status,'accepted');
 assert.deepEqual(out.trail.map(x=>x.stage),['worker','check','scope','review']);
 const events=(await store.load()).events;
 assert.ok(events.some(e=>e.type==='delegate-started')&&events.some(e=>e.type==='delegate-finished'));
});
test('blocking findings trigger autonomous repair with one bounded Jev course-correction',async t=>{
 const {dir,store}=await fixture(t);const dispatches={n:0};
 const out=await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir,dispatches) as any,runReviewer:fakeReviewer(dir,[[...blocking],[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted');
 assert.equal(dispatches.n,2);
 assert.equal(c.taskOf(await store.load(),'a').cycles,1);
 assert.ok(out.trail.some(x=>x.stage==='jev-strategy'&&(x.detail as any).choice==='targeted'));
});
test('exhausted repair allowance escalates to host depth instead of looping forever',async t=>{
 const {dir,store}=await fixture(t);
 await store.transaction(s=>{s.config.flashRepairCycles=0;s.config.deepRepairCycles=0;});
 const out=await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[...blocking]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'escalated');assert.equal(out.stage,'repair-exhausted');assert.equal(out.depth,'host');
 const task=c.taskOf(await store.load(),'a');assert.equal(task.status,'repair');assert.equal(task.depth,'host');
});
test('worker failure returns a failed outcome and preserves the trail',async t=>{
 const {dir,store}=await fixture(t);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:(async()=>{throw new Error('pi exploded');}) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'failed');assert.match(out.reason as string,/pi exploded/);
});
test('worker-side Jev helper answers and records its origin for health auditing',async t=>{
 const {store}=await fixture(t);
 const fetcher=(async(_url:any,init:any)=>{const body=JSON.parse(init.body);const criteria=body.questions.selection.criteria;return Response.json({model:'test/jev',answers:{selection:{type:'choice',choice:'safe',confidence:.9,probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k==='safe'?.9:.1]))}}});}) as typeof fetch;
 const answer=await jevAsk(store,{taskId:'a',question:'Which approach?',options:['safe','risky']},fetcher);
 assert.equal(answer.choice,'safe');
 assert.ok((await store.load()).events.some(e=>e.type==='worker-jev'&&(e.detail as any).taskId==='a'));
});
test('batched decisions settle independent questions in one gateway call',async t=>{
 const {store}=await fixture(t);let calls=0;
 const fetcher=(async(_url:any,init:any)=>{calls++;const body=JSON.parse(init.body);const answers=Object.fromEntries(Object.keys(body.questions).map(k=>[k,{type:'choice',choice:'x',confidence:.9,probabilities:{x:.9,y:.1}}]));return Response.json({model:'test/jev',answers});}) as typeof fetch;
 const answers=await decideBatch(store,{decisions:[{id:'b1',question:'q1',criteria:{x:'x',y:'y'},state:{}},{id:'b2',question:'q2',criteria:{x:'x',y:'y'},state:{}}]},fetcher);
 assert.equal(calls,1);assert.deepEqual(answers.map(a=>a.choice),['x','x']);
 assert.equal((await store.load()).decisions.length,2);
});
test('process health flags coordinator micromanagement and missing delegation',async t=>{
 const {store}=await fixture(t);
 await store.transaction(s=>{for(let i=0;i<3;i++)s.decisions.push({id:`d${i}`,question:'q',criteria:{a:'a',b:'b'},state:{},revision:s.revision,choice:'a',source:'test/jev',artifact:'x'.repeat(64)});c.event(s,'claimed',{id:'a',model:'deepseek/flash'});});
 const health=await processHealth(store);
 if(!health.available)throw new Error(health.reason);
 assert.match(health.warnings.join('\n'),/micro-decision/);
 assert.match(health.warnings.join('\n'),/delegate/);
 assert.match(health.warnings.join('\n'),/worker-side Jev/);
});

async function batchFixture(t:any,ids:string[],maxWorkers:number,withChecks=true){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-batch-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='sk-delegate-fixture-not-real';t.after(()=>{if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
 const store=await c.start(dir,{shape:clearCut,id:'batch',host:{kind:'codex',model:'gpt-6-astra'},intent:'Correct charge amount',criteria:['Correct amount charged']});
 await c.plan(store,{tasks:ids.map(id=>withChecks?task(id):({...task(id),checks:[],noProbe:'No executable checks for this batch fixture'} as c.Task)),integrationChecks:[]});
 const spaces:Record<string,string>={};
 for(const id of ids){const workspace=join(dir,'w-'+id);await mkdir(workspace,{recursive:true});await writeFile(join(workspace,'app.txt'),'original '+id);spaces[id]=await realpath(workspace);}
 await store.transaction(s=>{s.config.maxWorkers=maxWorkers;for(const id of ids)c.taskOf(s,id).workspace=spaces[id];});
 return {dir,store,spaces};
}
function arrivalGate(width:number,timeoutMs=4000){
 let seen=0,open=()=>{};
 const opened=new Promise<void>(resolve=>{open=resolve;});
 const timer=setTimeout(open,timeoutMs);timer.unref?.();
 return async()=>{if(++seen>=width){clearTimeout(timer);open();}await opened;};
}
const batchWorker=(spaces:Record<string,string>,hooks:{delays?:Record<string,number>;fail?:string[];live?:{n:number;peak:number};gate?:()=>Promise<void>}={})=>async (store:any,id:string,input:any)=>{
 const live=hooks.live;if(live){live.n++;live.peak=Math.max(live.peak,live.n);}
 try{
  await hooks.gate?.();
  if(live)live.peak=Math.max(live.peak,live.n);
  await new Promise(r=>setTimeout(r,hooks.delays?.[id]??40));
  if(hooks.fail?.includes(id))throw new Error('pi exploded on '+id);
  await fixtureClaim(store,id,{workspace:input.workspace??spaces[id],model:'deepseek/flash'});
  writeFileSync(join(input.workspace??spaces[id],'app.txt'),'corrected');
  await c.result(store,id,{changed:'app.txt'});
  return {artifact:c.taskOf(await store.load(),id).output};
 }finally{if(live)live.n--;}
};
const batchReviewer=(script:Record<string,any[][]>={})=>{const calls:Record<string,number>={};return async (store:any,id:string)=>{
 const list=script[id]??[[]],call=calls[id]??0;calls[id]=call+1;
 const findings=list[Math.min(call,list.length-1)],workspace=c.taskOf(await store.load(),id).workspace!;
 await c.review(store,id,{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(workspace),findings,report:'Synthetic fixture review',coverage:await syntheticCoverage(store,id)});
 return {findings};
};};

test('delegate-batch drives the whole frontier and never exceeds maxWorkers at once',{timeout:60000},async t=>{
 const ids=['a','b','c','d','e','f'];
 const {store,spaces}=await batchFixture(t,ids,2);
 const live={n:0,peak:0};
 const out=await delegateBatch(store,{ids},{runWorker:batchWorker(spaces,{live,gate:arrivalGate(2)}) as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted});
 assert.equal(out.delegated,6);
 assert.equal(out.concurrency,2);
 assert.ok(live.peak<=2,`peak concurrency ${live.peak} exceeded the configured maxWorkers of 2`);
 assert.equal(live.peak,2,'two workers never overlapped, so the batch ran serially');
 assert.deepEqual(out.outcomes.map(o=>o.outcome),ids.map(()=>'accepted'));
 assert.deepEqual((await store.load()).tasks.map(t=>t.status),ids.map(()=>'accepted'));
});
test('a failing id neither aborts the batch nor hides its reason',async t=>{
 const ids=['a','b','c'];
 const {store,spaces}=await batchFixture(t,ids,3);
 await store.transaction(s=>{const held=c.taskOf(s,'c');held.status='blocked';held.blocked='Held blocked by fixture';});
 const out=await delegateBatch(store,{ids},{runWorker:batchWorker(spaces,{fail:['b']}) as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted});
 assert.deepEqual(out.outcomes.map(o=>o.outcome),['accepted','failed','failed']);
 assert.match((out.outcomes[1] as {reason:string}).reason,/pi exploded on b/);
 assert.equal(out.outcomes[2].task,'c');
 assert.match((out.outcomes[2] as {reason:string}).reason,/not delegable/);
 assert.equal(c.taskOf(await store.load(),'a').status,'accepted');
});
test('a batch holds a chunk whose resources overlap a running chunk and starts it when that one finishes',{timeout:60000},async t=>{
 const ids=['doc','notes','other'];
 const {store,spaces}=await batchFixture(t,ids,3);
 await store.transaction(s=>{c.taskOf(s,'doc').resources=['website/**/*.md'];c.taskOf(s,'notes').resources=['website/DESIGN-SYSTEM.md'];c.taskOf(s,'other').resources=['amaleh/scripts/**'];});
 const live=new Set<string>(),overlapped:string[]=[];let parallel=false;
 const worker=batchWorker(spaces,{gate:arrivalGate(2)}) as any;
 const watching=async(s:any,id:string,input:any)=>{
  live.add(id);if(live.has('doc')&&live.has('notes'))overlapped.push(id);if(live.size>1)parallel=true;
  try{return await worker(s,id,input);}finally{live.delete(id);}
 };
 const out=await delegateBatch(store,{ids},{runWorker:watching as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted});
 assert.deepEqual(out.outcomes.map(o=>o.outcome),['accepted','accepted','accepted'],JSON.stringify(out.outcomes.map(o=>(o as {reason?:string}).reason)));
 assert.deepEqual(overlapped,[],'two chunks owning the same file must never run at once');
 assert.ok(parallel,'a chunk with separate resources still runs alongside');
});
test('outcomes come back in input order regardless of completion order',async t=>{
 const ids=['a','b','c'];
 const {store,spaces}=await batchFixture(t,ids,3,false);
 const completed:string[]=[],reviewer=batchReviewer();
 let releaseC:()=>void=()=>{};
 const cReviewed=new Promise<void>(resolve=>{releaseC=resolve;});
 const out=await delegateBatch(store,{ids},{runWorker:batchWorker(spaces,{delays:{a:20,b:10,c:5}}) as any,runReviewer:(async (s:any,id:string)=>{
  if(id!=='c')await Promise.race([cReviewed,new Promise<void>(resolve=>setTimeout(resolve,2000))]);
  const r=await reviewer(s,id);completed.push(id);if(id==='c')releaseC();
  return r;
 }) as any,fetcher:jevTargeted});
 assert.deepEqual(out.outcomes.map(o=>o.task),['a','b','c']);
 assert.equal(completed[0],'c');
 assert.notDeepEqual(completed,ids);
 assert.deepEqual([...completed].sort(),[...ids].sort());
 assert.deepEqual(out.outcomes.map(o=>o.outcome),['accepted','accepted','accepted']);
});
test('delegate-batch rejects malformed and duplicated id lists before dispatching anything',async t=>{
 const {store,spaces}=await batchFixture(t,['a','b'],2);
 let dispatches=0;
 const deps={runWorker:(async(s:any,id:string,input:any)=>{dispatches++;return batchWorker(spaces)(s,id,input);}) as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted};
 await assert.rejects(()=>delegateBatch(store,{ids:['a','b','a']},deps),/duplicate task ids \(a\)/);
 await assert.rejects(()=>delegateBatch(store,{ids:[]},deps),/one or more task id strings/);
 await assert.rejects(()=>delegateBatch(store,{ids:'a' as unknown as string[]},deps),/one or more task id strings/);
 await assert.rejects(()=>delegateBatch(store,{ids:['a','']},deps),/one or more task id strings/);
 assert.equal(dispatches,0);
});
test('task skills and references reach the worker on the first call and on the repair call',async t=>{
 const {dir,store}=await fixture(t);
 const seen:any[]=[],base=fakeWorker(dir);
 const spy=async (store:any,id:string,input:any)=>{seen.push(input);return base(store,id,input);};
 const out=await delegate(store,'a',{workspace:dir,skills:['superpowers:tdd'],references:['docs/business-rules/checkout.md']},{runWorker:spy as any,runReviewer:fakeReviewer(dir,[[...blocking],[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted');
 assert.equal(seen.length,2);
 for(const input of seen){assert.deepEqual(input.skills,['superpowers:tdd']);assert.deepEqual(input.references,['docs/business-rules/checkout.md']);}
 assert.match(seen[1].brief,/^Repair this task/);
});
test('record-decision marks the settled answer as a requirement so reviewers and lineage inherit it',async t=>{
 const {dir,store}=await fixture(t);
 const workspace=await realpath(dir),inputPath=join(workspace,'decision.json');
 await writeFile(inputPath,JSON.stringify({id:'refund-window',question:'How long may a guest request a refund?',answer:'Within 24 hours of the order',source:'user',reason:'Confirmed by the user in session'}));
 await main(['record-decision',workspace,'deleg',inputPath]);
 const state=await store.load(),recorded=state.decisions.find(d=>d.id==='refund-window')!;
 assert.equal(recorded.purpose,'requirement');
 assert.equal(recorded.choice,'accepted');
 assert.equal(recorded.criteria.accepted,'Within 24 hours of the order');
 assert.ok(state.events.some(e=>e.type==='recorded-decision'&&(e.detail as any).purpose==='requirement'));
});
test('a check that writes build output does not strand the chunk as permanently stale',async t=>{
 const {dir,store}=await fixture(t);
 const buildDir=join(dir,'.output');
 const emit=`require('node:fs').mkdirSync(${JSON.stringify(buildDir)},{recursive:true});require('node:fs').writeFileSync(${JSON.stringify(join(buildDir,'index.html'))},'<!doctype html>');`;
 await store.transaction(s=>{c.taskOf(s,'a').checks=[
  {id:'types',command:process.execPath,args:['-e',"try{const c=require('fs').readFileSync(require('path').join(process.cwd(),'app.txt'),'utf8');process.exit(c.includes('corrected')?0:1)}catch{process.exit(1)}"],role:'probe' as const},
  {id:'build',command:process.execPath,args:['-e',emit],role:'guard' as const}];});
 const out=await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted',`build output must not make acceptance impossible: ${out.reason ?? ''}`);
 const task=c.taskOf(await store.load(),'a');
 const settled=await c.fingerprint(dir);
 for(const check of task.checks)assert.ok(task.receipts.some(r=>r.id===check.id&&r.code===0&&r.fingerprint===settled),`receipt for ${check.id} must match the tree the checks leave behind`);
 assert.ok(out.trail.filter(s=>s.stage==='check').length>task.checks.length,'the stale receipts must be re-taken on a later pass');
});
test('a check that never leaves the tree alone escalates instead of looping',async t=>{
 const {dir,store}=await fixture(t);
 const churn=`require('node:fs').writeFileSync(${JSON.stringify(join(dir,'churn.txt'))},String(Date.now())+Math.random());`;
 await store.transaction(s=>{c.taskOf(s,'a').checks=[{id:'build',command:process.execPath,args:['-e',churn],role:'guard' as const}];c.taskOf(s,'a').noProbe='Guard check only; churn test';});
 const out=await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'escalated');
 assert.equal(out.stage,'unstable-checks');
 assert.deepEqual(out.mutating,['build']);
 assert.match(String(out.reason),/rewrite the workspace every run/);
});
const rateLimit=()=>new Error('429: {"message":"Provider returned error","code":429,"metadata":{"raw":"z-ai/glm-5.3-flashx is temporarily rate-limited upstream."}}');
test('a rate-limited provider is routed around without spending a repair cycle',async t=>{
 const {dir,store}=await fixture(t);
 let calls=0;
 const flaky=async(s:any,id:string,input:any)=>{
  if(++calls<3){await store.transaction(x=>{const t=c.taskOf(x,id);t.status='blocked';t.blocked=rateLimit().message;c.event(x,'worker-blocked',{id,reason:t.blocked});});throw rateLimit();}
  return fakeWorker(dir)(s,id,input);
 };
 const out=await delegate(store,'a',{workspace:dir},{runWorker:flaky as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted');
 assert.equal(calls,3,'the worker must be retried on a fresh route, not abandoned');
 const state=await store.load(),task=c.taskOf(state,'a');
 assert.equal(task.cycles,0,'a provider outage must not consume a repair cycle');
 assert.equal(task.blocked,undefined);
 assert.equal(state.events.filter(e=>e.type==='provider-failover').length,2);
 assert.deepEqual(out.trail.filter(s=>s.stage==='provider-failover').length,2);
});
test('a failover budget that runs out reports the provider message instead of retrying forever',async t=>{
 const {dir,store}=await fixture(t);
 let calls=0;
 const dead=async(s:any,id:string)=>{calls++;await store.transaction(x=>{const t=c.taskOf(x,id);t.status='blocked';t.blocked=rateLimit().message;});throw rateLimit();};
 const out=await delegate(store,'a',{workspace:dir},{runWorker:dead as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'failed');
 assert.match(String(out.reason),/rate-limited/);
 assert.equal(calls,(await loadModelConfig()).providerFailovers);
});
test('a genuine task failure is not mistaken for a provider outage',async t=>{
 const {dir,store}=await fixture(t);
 let calls=0;
 const broken=async(s:any,id:string)=>{calls++;throw new Error('pi resolved a different model (other/model); update the task route explicitly');};
 const out=await delegate(store,'a',{workspace:dir},{runWorker:broken as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.equal(out.outcome,'failed');
 assert.equal(calls,1,'only transient provider failures may be retried');
});
test('a batch sharing one workspace is refused before any worker starts',async t=>{
 const ids=['a','b','c'];const {store,spaces}=await batchFixture(t,ids,3);
 let started=0;const counting=async(...args:any[])=>{started++;return (batchWorker(spaces) as any)(...args);};
 await assert.rejects(()=>delegateBatch(store,{ids,workspace:spaces['a']},{runWorker:counting as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted}),/share workspace/);
 assert.equal(started,0);
 await store.transaction(s=>{c.taskOf(s,'b').workspace=spaces['a'];});
 await assert.rejects(()=>delegateBatch(store,{ids},{runWorker:counting as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted}),/a and b share workspace/);
 assert.equal(started,0);
 await store.transaction(s=>{c.taskOf(s,'c').workspace=undefined;});
 await assert.rejects(()=>delegateBatch(store,{ids:['c']},{runWorker:counting as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted}),/Task c has no workspace/);
 assert.equal(started,0);
});
test('a per-chunk brief reaches only its own worker, and a brief for a task outside the batch is refused',async t=>{
 const ids=['a','b'];const {store,spaces}=await batchFixture(t,ids,2);
 const seen:Record<string,unknown>={};
 const recording=async(store:any,id:string,input:any)=>{seen[id]=input.brief;return (batchWorker(spaces) as any)(store,id,input);};
 const deps={runWorker:recording as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted};
 await assert.rejects(()=>delegateBatch(store,{ids,briefs:{c:'stray'}},deps),/briefs for c, which is not in ids/);
 await assert.rejects(()=>delegateBatch(store,{ids,briefs:{a:''}},deps),/non-empty brief strings/);
 await delegateBatch(store,{ids,briefs:{a:'Keep the monogram inside its tile'}},deps);
 assert.deepEqual(seen,{a:'Keep the monogram inside its tile',b:undefined});
});
test('wait reports finished chunks after the cursor, idles when nothing runs, and names an interrupted delegation',async t=>{
 const ids=['a','b'];const {store,spaces}=await batchFixture(t,ids,2);
 assert.equal((await waitForDelegations(store,{timeoutMs:0})).outcome,'idle');
 const cursor=(await store.load()).events.length;
 await store.transaction(s=>c.taskOf(s,'b').status='blocked');
 await delegateBatch(store,{ids},{runWorker:batchWorker(spaces) as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted});
 const done=await waitForDelegations(store,{after:cursor,timeoutMs:0});
 assert.equal(done.outcome,'finished');
 const byId=Object.fromEntries(done.finished.map(f=>[f.id,f]));
 assert.deepEqual([byId.a?.outcome,byId.b?.outcome],['accepted','failed'],'a chunk refused before it starts must still reach the waiter');
 assert.match(String(byId.b.reason),/not delegable/);
 assert.equal((await waitForDelegations(store,{after:done.cursor,timeoutMs:0})).outcome,'idle');
 await store.transaction(s=>c.event(s,'delegate-started',{id:'a',pid:2147483647,host:hostname()}));
 const lost=await waitForDelegations(store,{after:done.cursor,timeoutMs:5000});
 assert.equal(lost.outcome,'interrupted');assert.deepEqual(lost.interrupted,['a']);
 await c.resume(store);
 assert.equal((await waitForDelegations(store,{timeoutMs:0})).outcome,'idle','resume closes a delegation whose process is gone');
 await assert.rejects(()=>waitForDelegations(store,{timeoutMs:600000}),/from 0 to 540000/);
});
test('wait holds while a live delegation runs and returns the moment it finishes',async t=>{
 const {store}=await batchFixture(t,['a'],1);
 await store.transaction(s=>c.event(s,'delegate-started',{id:'a',pid:process.pid,host:hostname()}));
 const cursor=(await store.load()).events.length;
 assert.equal((await waitForDelegations(store,{after:cursor,timeoutMs:50},10)).outcome,'still-running');
 setTimeout(()=>{void store.transaction(s=>c.event(s,'delegate-finished',{id:'a',outcome:'accepted'}));},100);
 const out=await waitForDelegations(store,{after:cursor,timeoutMs:5000},10);
 assert.equal(out.outcome,'finished');assert.deepEqual(out.live,[]);
});
test('the CLI detaches a batch and reports a batch that dies before starting any chunk',async t=>{
 const {dir,store}=await batchFixture(t,['a'],1);
 await store.transaction(s=>{c.taskOf(s,'a').workspace=undefined;});
 const inputPath=join(dir,'batch.json');await writeFile(inputPath,JSON.stringify({ids:['a']}));
 await assert.rejects(()=>main(['delegate-batch',dir,'batch',inputPath]),/exited with code 1 before starting any chunk: .*Task a has no workspace/s);
});
test('the repair budget changes only on a quoted user instruction, and worker capacity stays free',async t=>{
 const {dir,store}=await fixture(t);const workspace=await realpath(dir);
 const write=async(name:string,value:unknown)=>{const path=join(workspace,name);await writeFile(path,JSON.stringify(value));return path;};
 const raise=await write('raise.json',{flashRepairCycles:6,deepRepairCycles:2});
 await assert.rejects(()=>main(['configure',workspace,'deleg',raise]),/repair budget is the user's policy: changing flashRepairCycles and deepRepairCycles needs userInstruction/);
 await main(['configure',workspace,'deleg',await write('same.json',{maxWorkers:5,flashRepairCycles:2,deepRepairCycles:1})]);
 assert.deepEqual((await store.load()).config,{flashRepairCycles:2,deepRepairCycles:1,maxWorkers:5});
 await main(['configure',workspace,'deleg',await write('asked.json',{flashRepairCycles:4,userInstruction:'Give the cheap models four tries before Kimi'})]);
 const state=await store.load();
 assert.equal(state.config.flashRepairCycles,4);
 assert.equal((state.events.at(-1)!.detail as any).userInstruction,'Give the cheap models four tries before Kimi');
});
test('a reopened chunk carries its reason to the worker and binds the reviewer until it is accepted again',async t=>{
 const {dir,store}=await fixture(t);
 await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 await store.transaction(s=>c.invalidateTree(s,'a','Monogram G clips 0.2 units past the viewBox edge'));
 const s=await store.load(),t0=c.taskOf(s,'a');
 assert.deepEqual(c.reviewObligations(s,t0).filter(o=>o.id.startsWith('reopened:')).map(o=>o.id),['reopened:1']);
 assert.deepEqual((await c.packet(store,'a') as any).reopened,['Monogram G clips 0.2 units past the viewBox edge']);
 await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await c.result(store,'a',{});
 const coverage=(await syntheticCoverage(store,'a')).map(o=>o.id==='reopened:1'?{...o,status:'not-applicable' as const}:o);
 const fp=await c.fingerprint(dir);
 await assert.rejects(()=>c.review(store,'a',{model:'z-ai/glm-flash',fingerprint:fp,findings:[],report:'Synthetic fixture review',coverage}),/reopen reasons cannot be not-applicable/);
 await c.check(store,'a','test');
 await c.review(store,'a',{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(dir),findings:[],report:'Synthetic fixture review',coverage:await syntheticCoverage(store,'a')});
 await c.accept(store,'a');
 assert.deepEqual(c.reopenReasons(await store.load(),'a'),[]);
});
test('process health flags hand-stepped loops and repeated reopening even when chunks were delegated',async t=>{
 const {store}=await fixture(t);
 await store.transaction(s=>{c.event(s,'delegate-started',{id:'a'});for(let i=0;i<2;i++)c.event(s,'invalidated',{id:'a',reason:'host found a defect',affected:['a']});});
 for(const op of ['cli:reviewer','cli:repair'])await (await trace(store.root,op,{runId:'deleg'})).end('success');
 const health=await processHealth(store);
 if(!health.available)throw new Error(health.reason);
 assert.match(health.warnings.join('\n'),/2 worker, reviewer, repair and accept call\(s\) made by hand/);
 assert.match(health.warnings.join('\n'),/2 invalidation\(s\) reopened chunks/);
});
test('process health counts only the coordinator\'s own state-changing operations',async t=>{
 const {store}=await fixture(t);
 for(const op of ['cli:plan','cli:delegate-batch','batch:delegate-batch','cli:health','cli:integrated','cli:fingerprint'])await (await trace(store.root,op,{runId:'deleg'})).end('success');
 const health=await processHealth(store);
 if(!health.available)throw new Error(health.reason);
 assert.equal(health.metrics.coordinatorOperations,3,'plan, the batch launch and integrated; not the detached batch process or read-only calls');
 assert.equal(health.metrics.revisionAllowance,undefined);
});
test('the coordinator operation count skips failed calls and the detached batch that older runs traced as a CLI call',()=>{
 const at=(minute:number,second=0)=>new Date(Date.UTC(2026,8,26,12,minute,second)).toISOString();
 const op=(operation:string,started:string,elapsedMs:number,outcome='success')=>({operation,started,elapsedMs,outcome});
 const operations=[
  op('cli:plan',at(0),50),op('cli:plan',at(1),10,'failed'),
  op('cli:delegate-batch',at(2),4000),op('cli:delegate-batch',at(2,1),3600000),
  op('cli:delegate-batch',at(30),3000),op('cli:delegate-batch',at(30,1),600000),
  op('cli:integrated',at(40),80)];
 assert.equal(coordinatorOperationCount(operations),4,'one plan, two batch launches inside a long running batch, one integrated');
});
test('reopening a delivered chunk hands its probe to the task so every later repair runs it',async t=>{
 const {dir,store}=await fixture(t);
 await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 await assert.rejects(()=>c.invalidate(store,{id:'a',reason:'Label spills out of its card'}),/needs the probe that found the defect/);
 await assert.rejects(()=>c.invalidate(store,{id:'a',reason:'x',check:{id:'test',command:'other',args:[],role:'probe' as const}}),/already has a different check named test/);
 const rendered={id:'rendered',command:process.execPath,args:['-e','process.exit(1)'],role:'probe' as const};
 await c.invalidate(store,{id:'a',reason:'Label spills out of its card',check:rendered});
 await c.invalidate(store,{id:'a',reason:'Same probe again',check:rendered});
 const task=c.taskOf(await store.load(),'a');
 assert.deepEqual(task.checks.map(x=>x.id),['test','rendered']);
 assert.equal(task.status,'ready');
 const out=await delegate(store,'a',{workspace:dir},{runWorker:fakeWorker(dir) as any,runReviewer:fakeReviewer(dir,[[]]) as any,fetcher:jevTargeted});
 assert.ok(out.trail.some(s=>s.stage==='check'&&(s.detail as any).check==='rendered'),'the handed-over probe must run inside the chunk loop');
 await c.invalidate(store,{id:'a',reason:'Copy reads wrong',noProbe:'Tone of the headline copy; no executable can judge it'});
 assert.equal(c.taskOf(await store.load(),'a').status,'ready');
});
test('model speed names a model far slower than its role median without blocking finish',async t=>{
 const {store}=await fixture(t);
 const call=(model:string,elapsedMs:number)=>({operation:'pi',outcome:'success',started:new Date().toISOString(),elapsedMs,metadata:{model,readOnly:true},events:[{stage:'usage',data:{outputTokens:1000}}]});
 const ops=['slow/reviewer','fast/one','fast/two'].flatMap(model=>Array.from({length:3},()=>call(model,model==='slow/reviewer'?1200000:300000)));
 const speeds=modelSpeed(speedSamples(ops));
 assert.deepEqual(speeds.map(s=>[s.model,s.role,s.calls,s.averageMinutes,s.outputTokensPerCall]),[['slow/reviewer','reviewer',3,20,1000],['fast/one','reviewer',3,5,1000],['fast/two','reviewer',3,5,1000]]);
 const slow=slowModels(speeds);
 assert.deepEqual(slow.map(s=>[s.model,s.medianMinutes,s.times]),[['slow/reviewer',5,4]]);
 assert.deepEqual(slowModels(speeds.slice(0,2)),[],'two models are too few to call either one slow');
 const health=await processHealth(store);
 if(!health.available)throw new Error(health.reason);
 assert.ok(!health.warnings.some(w=>/slow|min per call/.test(w)),'a slow vendor is not a coordinator anti-pattern and must not block finish');
});
test('batch guidance reaches every delegated worker',async t=>{
 const ids=['a','b'];const {store,spaces}=await batchFixture(t,ids,2);
 const seen:Record<string,unknown>={};
 const recording=async(store:any,id:string,input:any)=>{seen[id]={skills:input.skills,references:input.references};return (batchWorker(spaces) as any)(store,id,input);};
 await delegateBatch(store,{ids,skills:['taste-bar'],references:['docs/contract.md']},{runWorker:recording as any,runReviewer:batchReviewer() as any,fetcher:jevTargeted});
 for(const id of ids)assert.deepEqual(seen[id],{skills:['taste-bar'],references:['docs/contract.md']});
});
