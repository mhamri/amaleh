import {fixtureClaim,clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { selectModel, consumeRoute } from '../scripts/routing.ts';
import { worker, reviewer } from '../scripts/adapters.ts';
import { slowModels } from '../scripts/telemetry.ts';

const card=(id:string,created:number,images=false)=>({id,created,context_length:64000,architecture:{input_modalities:images?['text','image']:['text']},supported_parameters:['tools'],pricing:{prompt:'0.000001',completion:'0.000002'},description:'Synthetic test card, not a capability benchmark'});
const cards=[card('deepseek/old-flash',1),card('deepseek/new-flash',3),card('z-ai/glm-new-flash',4),card('moonshot/kimi-specialist',5,true),card('deepseek/preview-flash',9),card('~deepseek/deepseek-flash-latest',10),card('z-ai/glm-flash-latest',11)];
const testModels={flash:['z-ai/glm-new-flash','deepseek/new-flash'],deep:['moonshot/kimi-specialist'],jev:'typesafe/jev-1.13',providerCooldownMs:300000,providerFailovers:3,launchAttempts:3,idleTimeoutMs:900000,slowModelWindowMs:604800000,reviewerMaxTurns:60};
const initialModels=process.env.AMALEH_MODELS;
const restoreModels=()=>{if(initialModels===undefined)delete process.env.AMALEH_MODELS;else process.env.AMALEH_MODELS=initialModels;};
async function useModels(t:any,dir:string,overrides:Partial<typeof testModels>={}){
 const path=join(dir,'models.json');await writeFile(path,JSON.stringify({...testModels,...overrides}));
 process.env.AMALEH_MODELS=path;
 t.after(restoreModels);
 return path;
}
async function fixture(t:any,overrides:Partial<typeof testModels>={}){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-routing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await useModels(t,dir,overrides);
 const oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='sk-routing-fixture-not-real';t.after(()=>{if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
 const store=await c.start(dir,{shape:clearCut,id:'route',host:{kind:'codex',model:'gpt-6-astra'},intent:'Test enforced automatic routes',criteria:['Select suitable author and independent reviewer']});
 await c.plan(store,{tasks:[{id:'a',title:'a',goal:'Fix known amount',phase:'one',deps:[],resources:['a'],criteria:['correct amount'],checks:[],noProbe:'Routing test fixture with no executable checks',kind:'code'}],integrationChecks:[]});
 return {dir,store};
}
// Only the catalog endpoint is called now: selection is deterministic rotation, not a Jev question.
function gateway(){const calls:string[]=[];const fetcher=(async(url:any)=>{calls.push(String(url));return Response.json({data:cards});}) as typeof fetch;return {calls,fetcher};}
const flashPair=['z-ai/glm-new-flash','deepseek/new-flash'];
const expectedPick=(runId:string,prior:number,eligible:string[])=>eligible[(parseInt(c.hash(runId).slice(0,8),16)+prior)%eligible.length];

test('round-robin selects deterministically from the run session hash and caches the route',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 const route=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(route.action,'launch');if(route.action!=='launch')throw Error('Expected launch');
 assert.equal(route.model,expectedPick('route',0,flashPair));
 const decision=(await store.load()).decisions[0];
 assert.equal(decision.source,'runtime:round-robin');
 assert.equal((decision.state as any).routing.models[decision.choice!],route.model);
 const cached=await selectModel(store,'a','worker',dir,{},g.fetcher);assert.deepEqual(cached,route);assert.equal(g.calls.length,1);
 await store.transaction(s=>consumeRoute(s,route));await assert.rejects(()=>store.transaction(s=>consumeRoute(s,route)),/consumed/);
});
test('rotation advances per routing decision and alternates families instead of fixating',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 await store.transaction(s=>{s.tasks.push({...s.tasks[0],id:'b',resources:['b']});});
 const first=await selectModel(store,'a','worker',dir,{},g.fetcher);if(first.action!=='launch')throw Error('Expected launch');
 await store.transaction(s=>consumeRoute(s,first));
 const second=await selectModel(store,'b','worker',dir,{},g.fetcher);if(second.action!=='launch')throw Error('Expected launch');
 assert.equal(second.model,expectedPick('route',1,flashPair));
 assert.notEqual(second.model,first.model);
});
test('specialized pool, modality and tool filters precede rotation; empty eligibility never dispatches',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 await store.transaction(s=>{s.modelPools=[{role:'visual',models:['moonshot/kimi-specialist','deepseek/new-flash'],requiredInputs:['image'],requiresTools:true,notes:'Fixture image requirement'}];});
 const route=await selectModel(store,'a','worker',dir,{role:'visual'},g.fetcher);assert.equal(route.action,'launch');if(route.action==='launch')assert.equal(route.model,'moonshot/kimi-specialist');
 const decision=(await store.load()).decisions[0];assert.equal(Object.keys((decision.state as any).routing.models).length,1);
 const blocked=await selectModel(store,'a','worker',dir,{requiredInputs:['audio']},g.fetcher);assert.equal(blocked.action,'route-blocked');assert.equal(g.calls.length,2);
});
test('deep repair selects Kimi and host repair returns native takeover without catalog calls',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 await store.transaction(s=>{s.tasks[0].depth='deep';s.tasks[0].cycles=3;});
 const deep=await selectModel(store,'a','worker',dir,{},g.fetcher);assert.equal(deep.action,'launch');if(deep.action==='launch')assert.equal(deep.model,'moonshot/kimi-specialist');
 await store.transaction(s=>{s.tasks[0].depth='host';s.tasks[0].cycles=4;});assert.deepEqual(await selectModel(store,'a','worker',dir,{},g.fetcher),{action:'host-takeover',model:'gpt-6-astra'});assert.equal(g.calls.length,1);
});
test('task changes invalidate grants while unrelated checkpoints do not',async t=>{
 const {dir,store}=await fixture(t),g=gateway();const route=await selectModel(store,'a','worker',dir,{},g.fetcher);if(route.action!=='launch')throw Error('Expected launch');
 await store.transaction(s=>c.event(s,'unrelated-checkpoint',{}));assert.deepEqual(await selectModel(store,'a','worker',dir,{},g.fetcher),route);
 await store.transaction(s=>{s.tasks[0].goal='Different amount contract';});await assert.rejects(()=>store.transaction(s=>consumeRoute(s,route)),/changed/);
});
test('changed requirements supersede a prior route instead of stranding completion',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 const first=await selectModel(store,'a','worker',dir,{},g.fetcher);assert.equal(first.action,'launch');
 await selectModel(store,'a','worker',dir,{evidence:'New measured suitability evidence'},g.fetcher);
 const decisions=(await store.load()).decisions;
 assert.equal(decisions[0].choice,'reassess');assert.equal(decisions[0].source,'runtime:route-invalidated');
 assert.ok(decisions[1].choice);assert.equal(decisions.filter(d=>!d.choice).length,0);
});
test('unrelated task activity during catalog fetch does not discard a valid route',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 const fetcher=(async(url:any)=>{await store.transaction(s=>c.event(s,'other-task-progress',{}));return g.fetcher(url);}) as typeof fetch;
 assert.equal((await selectModel(store,'a','worker',dir,{},fetcher)).action,'launch');
});
test('review routing excludes author family and binds reviewed content',async t=>{
 const {dir,store}=await fixture(t),g=gateway();await fixtureClaim(store,'a',{workspace:dir,model:'z-ai/glm-new-flash'});await c.result(store,'a',{});
 const route=await selectModel(store,'a','reviewer',dir,{},g.fetcher);assert.equal(route.action,'launch');if(route.action==='launch')assert.equal(route.model,'deepseek/new-flash');
 const decision=(await store.load()).decisions.find(d=>(d.state as any)?.routing?.scope?.purpose==='reviewer');
 assert.deepEqual(Object.values((decision!.state as any).routing.models),['deepseek/new-flash']);
 await writeFile(join(dir,'changed.txt'),'changed');
 await selectModel(store,'a','reviewer',dir,{},g.fetcher);assert.equal(g.calls.length,2);
});
test('worker and reviewer execute automatically selected models, with durable route consumption',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 const old={fetch:globalThis.fetch,entry:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 t.after(()=>{globalThis.fetch=old.fetch;for(const [key,value] of [['AMALEH_PI_ENTRY',old.entry],['AMALEH_NODE',old.node]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
 const entry=join(dir,'fake-pi.ts');await writeFile(entry,`import {readFileSync} from 'node:fs';
const model=process.argv[process.argv.indexOf('--model')+1];
const readOnly=process.argv[process.argv.indexOf('--tools')+1]==='read,grep,find,ls';
const prompt=process.argv.at(-1);
const handoff=prompt.match(/"([^"]*review-packet\\.md)"/);
if(readOnly&&!handoff)throw new Error('the reviewer prompt must name its review-packet file');
const packet=readOnly?JSON.parse(readFileSync(handoff[1],'utf8').match(/\\\`\\\`\\\`json\\n([\\s\\S]*?)\\n\\\`\\\`\\\`/)[1]):undefined;
const text=readOnly?JSON.stringify({report:'Synthetic reviewer fixture',coverage:packet.obligations.map(o=>({id:o.id,status:'covered',evidence:'Synthetic protocol fixture only'})),findings:[]}):'Synthetic worker fixture';
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',model,content:[{type:'text',text}],stopReason:'stop'}}));
console.log(JSON.stringify({type:'agent_end'}));`);
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;globalThis.fetch=g.fetcher;
 await worker(store,'a',{workspace:dir});
 const author=c.taskOf(await store.load(),'a').author!;assert.ok(flashPair.includes(author));
 await reviewer(store,'a',undefined,['Spec']);
 const review=c.taskOf(await store.load(),'a').review;assert.ok(review?.coverage?.length);
 assert.equal(review?.family,author.includes('glm')?'deepseek':'glm');
 assert.equal((await store.load()).events.filter(e=>e.type==='route-used').length,2);assert.equal(g.calls.length,2);
});
test('the worker brief frames run outcomes as background and names what other tasks own',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 await store.transaction(s=>{s.tasks.push({...s.tasks[0],id:'docs',title:'docs',goal:'Document the amount',resources:['website/VERIFICATION.md'],criteria:['amount documented'],receipts:[],status:'ready'});});
 const old={fetch:globalThis.fetch,entry:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 t.after(()=>{globalThis.fetch=old.fetch;for(const [key,value] of [['AMALEH_PI_ENTRY',old.entry],['AMALEH_NODE',old.node]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
 const entry=join(dir,'fake-pi.ts');await writeFile(entry,`const model=process.argv[process.argv.indexOf('--model')+1];
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',model,content:[{type:'text',text:'Synthetic worker fixture'}],stopReason:'stop'}}));
console.log(JSON.stringify({type:'agent_end'}));`);
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;globalThis.fetch=g.fetcher;
 await worker(store,'a',{workspace:dir});
 const brief=await readFile(join(store.root,'sessions','a','brief.md'),'utf8');
 assert.match(brief,/satisfy every criterion in task\.criteria/);
 assert.match(brief,/## Your share of the run\nThis task is one of 2 tasks in run route\./);
 const context=JSON.parse(brief.match(/```json\n([\s\S]*?)\n```/)![1]);
 assert.deepEqual(context.runOutcomes,['Select suitable author and independent reviewer']);
 assert.ok(!('criteria' in context),'run outcomes must not sit where a worker reads its own criteria');
 assert.deepEqual(context.otherTasks,[{id:'docs',goal:'Document the amount',resources:['website/VERIFICATION.md'],status:'ready'}]);
});
test('manual model overrides cannot bypass routing and credit errors cannot become host fallback',async t=>{
 const {dir,store}=await fixture(t),g=gateway();const old=globalThis.fetch;globalThis.fetch=g.fetcher;t.after(()=>{globalThis.fetch=old;});
 await assert.rejects(()=>worker(store,'a',{workspace:dir,brief:'fixture',model:'deepseek/old-flash'}),/disagrees/);assert.equal(c.taskOf(await store.load(),'a').status,'ready');
 await store.transaction(s=>{s.tasks[0].goal='Changed task';});await assert.rejects(()=>selectModel(store,'a','worker',dir,{},(async()=>new Response('{}',{status:402})) as typeof fetch),/402/);
});

test('worker dispatch preflight avoids all gateway calls for dependency, capacity and resource blocks',async t=>{
 for(const mode of ['dependency','capacity','workspace','resource'])await t.test(mode,async st=>{
  const {dir,store}=await fixture(st);await store.transaction(s=>{
   const other={...s.tasks[0],id:'other',deps:[],resources:['other']};s.tasks.push(other);
   if(mode==='dependency')s.tasks[0].deps=['other'];
   else{other.status='running';other.workspace=mode==='workspace'?dir:dir+'-different';other.owner={pid:process.pid,host:'fixture',operation:'fixture'};if(mode==='capacity')s.config.maxWorkers=1;if(mode==='resource')other.resources=['a'];}
  });
  let requests=0;const fetcher=(async()=>{requests++;throw Error('Preflight must not call gateway');}) as typeof fetch;
  const blocked=await selectModel(store,'a','worker',dir,{},fetcher);assert.equal(blocked.action,'dispatch-blocked');assert.equal(requests,0);
  assert.equal((await store.load()).decisions.length,0);
 });
});

test('a malformed review is re-requested with a format correction instead of discarded',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 await fixtureClaim(store,'a',{workspace:dir,model:'z-ai/glm-new-flash'});await c.result(store,'a',{});
 const old={fetch:globalThis.fetch,entry:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 t.after(()=>{globalThis.fetch=old.fetch;for(const [key,value] of [['AMALEH_PI_ENTRY',old.entry],['AMALEH_NODE',old.node]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
 const outside=await mkdtemp(join(tmpdir(),'amaleh-review-retry-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 const counter=join(outside,'review-attempts.txt'),entry=join(outside,'correcting-pi.ts'),argvLog=join(outside,'argv.jsonl');
 const obligations=c.reviewObligations(await store.load(),c.taskOf(await store.load(),'a')).map(o=>({id:o.id,status:'covered',evidence:'Synthetic fixture coverage, not a model judgment'}));
 const bad={report:'Synthetic fixture',coverage:obligations,findings:[{id:'f1',lens:'Spec',location:'app.txt',scenario:'wrong total',consequence:'overcharge',blocking:false}]};
 const good={report:'Synthetic fixture',coverage:obligations,findings:[]};
 await writeFile(entry,`import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(argvLog)},JSON.stringify(process.argv.slice(2))+'\\n');\nconst path=${JSON.stringify(counter)};\nlet n=0;try{n=Number(readFileSync(path,'utf8'));}catch{}\nwriteFileSync(path,String(n+1));\nconst model=process.argv[process.argv.indexOf('--model')+1];\nconst body=n===0?${JSON.stringify(JSON.stringify(bad))}:${JSON.stringify(JSON.stringify(good))};\nconsole.log(JSON.stringify({type:'message_end',message:{role:'assistant',model,content:[{type:'text',text:'Here is my review:\\n'+body}],stopReason:'stop'}}));\nconsole.log(JSON.stringify({type:'agent_end'}));\n`);
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;globalThis.fetch=g.fetcher;
 await writeFile(join(store.amalehDir,'model-speed.jsonl'),'');
 const out=await reviewer(store,'a',undefined,['Spec']);
 assert.ok('findings' in out);
 assert.equal(await readFile(counter,'utf8'),'2','the reviewer must be re-asked once with the exact rejection reason');
 const samples=(await readFile(join(store.amalehDir,'model-speed.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(samples.length,1,'the review and its correction are one speed sample');
 assert.equal(samples[0].role,'reviewer');
 assert.equal(samples[0].failed,undefined);
 const [first,second]=(await readFile(argvLog,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[]);
 assert.ok(!first.includes('--continue'),'the review starts a fresh session');
 assert.ok(second.includes('--continue'),'the correction continues the reviewer\'s own session instead of reviewing from zero');
 assert.equal(second[second.indexOf('--session-dir')+1],first[first.indexOf('--session-dir')+1]);
 assert.match(second.at(-1)!,/^Your previous reply was rejected: .*evidence/s,'the correction alone is the new prompt');
 const state=await store.load();
 assert.equal(c.taskOf(state,'a').review?.findings.length,0);
 const retries=state.events.filter(e=>e.type==='review-format-retry');
 assert.equal(retries.length,1);
 assert.match(String((retries[0].detail as any).reason),/evidence/i);
});

test('synthetic reviewer process owns capacity until completion and prevents duplicate routing',async t=>{
 const {dir,store}=await fixture(t),g=gateway();await fixtureClaim(store,'a',{workspace:dir,model:'z-ai/glm-new-flash'});await c.result(store,'a',{});
 const old={fetch:globalThis.fetch,entry:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 t.after(()=>{globalThis.fetch=old.fetch;for(const [key,value] of [['AMALEH_PI_ENTRY',old.entry],['AMALEH_NODE',old.node]])if(value===undefined)delete process.env[key!];else process.env[key!]=value;});
 const signals=await mkdtemp(join(tmpdir(),'amaleh-reviewer-signal-'));t.after(()=>rm(signals,{recursive:true,force:true}));
 const entry=join(dir,'synthetic-review-pi.ts'),release=join(signals,'release');
 await writeFile(entry,`const {existsSync}=process.getBuiltinModule('node:fs');const model=process.argv[process.argv.indexOf('--model')+1];const finish=()=>{console.log(JSON.stringify({type:'message_end',message:{role:'assistant',model,content:[{type:'text',text:JSON.stringify({report:'Synthetic reviewer fixture, not a model judgment',findings:[]})}],stopReason:'stop'}}));console.log(JSON.stringify({type:'agent_end'}));};const started=Date.now();const wait=()=>existsSync(${JSON.stringify(release)})||Date.now()-started>60000?finish():setTimeout(wait,20);wait();`);
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;globalThis.fetch=g.fetcher;
 const pending=reviewer(store,'a',undefined,['Spec']);let activity;
 for(let i=0;i<3000;i++){activity=c.taskOf(await store.load(),'a').activity;if(activity&&activity.owner.pid!==process.pid)break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(activity?.kind,'review');assert.equal(activity?.owner.coordinatorPid,process.pid);assert.notEqual(activity?.owner.pid,process.pid);
 const before=g.calls.length;const duplicate=await reviewer(store,'a',undefined,['Spec']);assert.ok('action' in duplicate);assert.equal(duplicate.action,'dispatch-blocked');assert.equal(g.calls.length,before);
 await writeFile(release,'');
 await pending;assert.equal(c.taskOf(await store.load(),'a').activity,undefined);
});

test('a worker route skips an excluded family unless that leaves no model',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 const skip=await selectModel(store,'a','worker',dir,{excludeFamilies:['deepseek']},g.fetcher);
 assert.equal(skip.action,'launch');if(skip.action!=='launch')throw Error('Expected launch');
 assert.equal(skip.model,'z-ai/glm-new-flash');
 await store.transaction(s=>{s.decisions=[];});
 const all=await selectModel(store,'a','worker',dir,{excludeFamilies:['deepseek','glm']},g.fetcher);
 assert.equal(all.action,'launch','excluding every family must not block a worker');
 const offered=Object.values(((await store.load()).decisions[0].state as any).routing.models);
 assert.deepEqual(offered.sort(),[...flashPair].sort());
});
test('a model that exhausted its retries is skipped until its cooldown expires',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 const first=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(first.action,'launch');if(first.action!=='launch')throw Error('Expected launch');
 const down=first.model,alternate=flashPair.find(m=>m!==down)!;
 await store.transaction(s=>{s.decisions=[];c.event(s,'provider-unavailable',{model:down,family:c.family(down),taskId:'a',purpose:'worker'});});
 const second=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(second.action,'launch');if(second.action!=='launch')throw Error('Expected launch');
 assert.equal(second.model,alternate,'routing must steer away from a model that just exhausted its retries');
 await store.transaction(s=>{s.decisions=[];const e=s.events.find(e=>e.type==='provider-unavailable')!;e.at=new Date(Date.now()-testModels.providerCooldownMs-1000).toISOString();});
 const third=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(third.action,'launch');if(third.action!=='launch')throw Error('Expected launch');
 assert.equal(third.model,down,'an expired cooldown must return the model to the rotation');
});

test('every eligible model cooling down still yields a route rather than blocking the run',async t=>{
 const {dir,store}=await fixture(t),g=gateway();
 await store.transaction(s=>{for(const model of flashPair)c.event(s,'provider-unavailable',{model,family:c.family(model),taskId:'a',purpose:'worker'});});
 const route=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(route.action,'launch');if(route.action!=='launch')throw Error('Expected launch');
 assert.ok(flashPair.includes(route.model));
});

const trio=['z-ai/glm-new-flash','deepseek/new-flash','deepseek/old-flash'];
async function eligibleNow(store:c.Store,dir:string,g:ReturnType<typeof gateway>){
 await store.transaction(s=>{s.decisions=[];});
 const route=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(route.action,'launch');
 const d=(await store.load()).decisions[0];
 return {offered:Object.values((d.state as any).routing.models) as string[],skipped:(d.state as any).skippedSlow as unknown[]};
}
async function speedLedger(store:c.Store,minutes:Record<string,number>,at=new Date().toISOString(),role='worker'){
 const lines=Object.entries(minutes).flatMap(([model,m])=>Array.from({length:3},()=>JSON.stringify({at,model,role,ms:m*60000,outputTokens:1000})));
 await writeFile(join(store.amalehDir,'model-speed.jsonl'),lines.join('\n')+'\n');
}
test('a model slow for its role is skipped until its slow calls age out of the window',async t=>{
 const {dir,store}=await fixture(t,{flash:trio}),g=gateway();
 const minutes={'deepseek/new-flash':20,'z-ai/glm-new-flash':5,'deepseek/old-flash':5};
 await speedLedger(store,minutes);
 const slow=await eligibleNow(store,dir,g);
 assert.deepEqual(slow.offered.sort(),['deepseek/old-flash','z-ai/glm-new-flash'],'a model four times slower than the median must not be offered');
 assert.deepEqual(slow.skipped,[{model:'deepseek/new-flash',averageMinutes:20,medianMinutes:5}]);
 await speedLedger(store,minutes,new Date(Date.now()-testModels.slowModelWindowMs-60000).toISOString());
 const aged=await eligibleNow(store,dir,g);
 assert.deepEqual(aged.offered.sort(),[...trio].sort(),'aged-out slowness must return the model to the rotation');
 assert.deepEqual(aged.skipped,[]);
});
test('only the configured peers set the median a model is judged against',async t=>{
 const {dir,store}=await fixture(t,{flash:trio}),g=gateway();
 await speedLedger(store,{'deepseek/new-flash':8,'z-ai/glm-new-flash':5,'deepseek/old-flash':5,'removed/one':2,'removed/two':2,'moonshotai/kimi-k3':1});
 const now=await eligibleNow(store,dir,g);
 assert.deepEqual(now.offered.sort(),[...trio].sort(),'removed models and the deep model must not drag the median down');
 assert.deepEqual(now.skipped,[]);
});
test('a slow model does not lower its own median',()=>{
 const speed=(model:string,averageMinutes:number)=>({model,role:'worker' as const,calls:3,failures:0,averageMinutes,longestMinutes:averageMinutes,outputTokensPerCall:1000,outputTokensPerSecond:1});
 const slow=slowModels([speed('a',5),speed('b',5),speed('c',20),speed('d',20)],['a','b','c','d']);
 assert.deepEqual(slow.map(s=>[s.model,s.medianMinutes,s.times]),[['c',5,4],['d',5,4]]);
});
test('slowness measured as a reviewer does not skip the same model as a worker',async t=>{
 const {dir,store}=await fixture(t,{flash:trio}),g=gateway();
 await speedLedger(store,{'deepseek/new-flash':20,'z-ai/glm-new-flash':5,'deepseek/old-flash':5},undefined,'reviewer');
 assert.deepEqual((await eligibleNow(store,dir,g)).offered.sort(),[...trio].sort());
});
test('a slow model is still routed when it is the only eligible one, and a zero window turns skipping off',async t=>{
 const {dir,store}=await fixture(t,{flash:['deepseek/new-flash']}),g=gateway();
 await speedLedger(store,{'deepseek/new-flash':20,'z-ai/glm-new-flash':5,'deepseek/old-flash':5});
 const only=await selectModel(store,'a','worker',dir,{},g.fetcher);
 assert.equal(only.action,'launch');if(only.action!=='launch')throw Error('Expected launch');
 assert.equal(only.model,'deepseek/new-flash');
 assert.deepEqual(((await store.load()).decisions[0].state as any).skippedSlow,[]);
 await useModels(t,dir,{flash:trio,slowModelWindowMs:0});
 assert.deepEqual((await eligibleNow(store,dir,g)).offered.sort(),[...trio].sort());
});
test('concurrent routes advance the rotation instead of all selecting one model',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-rotation-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await useModels(t,dir);
 const oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='sk-rotation-fixture-not-real';t.after(()=>{if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
 const ids=['a','b','c','d'];
 const store=await c.start(dir,{shape:clearCut,id:'rotation',host:{kind:'codex',model:'gpt-6-astra'},intent:'Distribute concurrent routes across eligible families',criteria:['Concurrent dispatch does not fixate on one vendor']});
 await c.plan(store,{tasks:ids.map(id=>({id,title:id,goal:'Fix known amount',phase:'one',deps:[],resources:[id],criteria:['correct amount'],checks:[],noProbe:'Routing rotation fixture with no executable checks',kind:'code' as const})),integrationChecks:[]});
 const spaces:Record<string,string>={};
 for(const id of ids){const workspace=join(dir,'w-'+id);await mkdir(workspace,{recursive:true});spaces[id]=workspace;}
 await store.transaction(s=>{s.config.maxWorkers=ids.length;for(const id of ids)c.taskOf(s,id).workspace=spaces[id];});
 const g=gateway();
 const routes=await Promise.all(ids.map(id=>selectModel(store,id,'worker',spaces[id],{},g.fetcher)));
 const models=routes.map(r=>{assert.equal(r.action,'launch');if(r.action!=='launch')throw Error('Expected launch');return r.model;});
 const observed=(await store.load()).decisions.map(d=>(d.state as any).rotation.priorRoutes).sort((x:number,y:number)=>x-y);
 assert.deepEqual(observed,[0,1,2,3],'each concurrent route must observe the routes already recorded');
 assert.equal(new Set(models).size,flashPair.length,`concurrent dispatch fixated on ${[...new Set(models)].join(', ')}`);
 for(const model of flashPair)assert.equal(models.filter(m=>m===model).length,2,`uneven rotation across ${flashPair.join(' and ')}`);
});
