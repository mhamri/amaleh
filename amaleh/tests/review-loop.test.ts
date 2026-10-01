import {fixtureClaim,clearCut,jevGate,noJev} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as c from '../scripts/core.ts';
import {delegate} from '../scripts/delegate.ts';
import {selectModel} from '../scripts/routing.ts';
import {reviewer, blockingDefinition} from '../scripts/adapters.ts';

const task=(id:string)=>({id,title:id,goal:'Keep a finished review instead of discarding it',phase:'one',deps:[],resources:['review-loop'],criteria:['An incomplete review is retried once'],kind:'code' as const,checks:[{id:'test',command:process.execPath,args:['-e','process.exit(0)'],role:'guard' as const}],noProbe:'Test fixture; the reviewed behaviour is asserted by the test, not by an executable probe'});
async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-review-loop-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'app.txt'),'original');
 const store=await c.start(dir,{shape:clearCut,id:'loop',host:{kind:'codex',model:'gpt-6-astra'},intent:'Retry an incomplete review once',criteria:['An incomplete review is not thrown away']});
 await c.plan(store,{tasks:[task('a')],integrationChecks:[]});
 return {dir,store};
}
const syntheticWorker=(dir:string)=>async (store:any,id:string,input:any)=>{await fixtureClaim(store,id,{workspace:input.workspace??dir,model:'deepseek/flash'});await c.result(store,id,{changed:'app.txt'});return {artifact:c.taskOf(await store.load(),id).output};};
async function coverage(store:c.Store,id:string):Promise<c.ReviewCoverage[]>{
 const s=await store.load();
 return c.reviewObligations(s,c.taskOf(s,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic fixture coverage; not a model judgment'}));
}
type ReviewStep={model:string;debt?:boolean;findings?:c.Finding[];pending?:string};
function syntheticReviews(dir:string,script:ReviewStep[],calls:string[],routings:unknown[]){
 let call=0;
 return async (store:any,id:string,_model:string|undefined,_lenses:string[],routing?:unknown)=>{
  routings.push(routing);
  const step=script[Math.min(call,script.length-1)];call++;
  calls.push(step.model);
  if(step.pending)return {action:step.pending};
  const entries=await coverage(store,id);
  if(step.debt)entries[0]={...entries[0],status:'unreviewed',evidence:'The named host probe has not run yet'};
  await c.review(store,id,{model:step.model,fingerprint:await c.fingerprint(dir),findings:step.findings??[],report:'Synthetic fixture review; not a model judgment',coverage:entries});
  return {findings:step.findings??[]};
 };
}
test('a coverage gap without blocking findings gets exactly one fresh reviewer from another family',async t=>{
 const {dir,store}=await fixture(t);
 const calls:string[]=[],routings:unknown[]=[];
 const runReviewer=syntheticReviews(dir,[{model:'z-ai/glm-flash',debt:true},{model:'moonshot/kimi-x'}],calls,routings);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:runReviewer as any,fetcher:noJev});
 assert.equal(out.outcome,'accepted');
 assert.deepEqual(calls,['z-ai/glm-flash','moonshot/kimi-x'],'the loop must obtain exactly one second review');
 assert.equal(routings[0],undefined,'the first review uses the caller routing unchanged');
 assert.deepEqual((routings[1] as any)?.excludeFamilies,['glm'],'the retry must rule out the family that left the gap');
 const reviewed=c.taskOf(await store.load(),'a');
 assert.equal(reviewed.status,'accepted');
 assert.equal(reviewed.review?.family,'kimi','acceptance must rest on the retry, not the incomplete review');
 assert.equal(out.trail.filter(s=>s.stage==='review').length,2);
});
test('a second coverage gap escalates as host work and leaves the task actionable',async t=>{
 const {dir,store}=await fixture(t);
 const calls:string[]=[],routings:unknown[]=[];
 const runReviewer=syntheticReviews(dir,[{model:'z-ai/glm-flash',debt:true},{model:'moonshot/kimi-x',debt:true}],calls,routings);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:runReviewer as any,fetcher:noJev});
 assert.equal(out.outcome,'escalated');
 assert.equal(out.stage,'review-evidence');
 assert.deepEqual(calls,['z-ai/glm-flash','moonshot/kimi-x'],'a second gap must not buy another review');
 assert.ok((out.obligations as unknown[]).length);
 const reviewed=c.taskOf(await store.load(),'a');
 assert.equal(reviewed.status,'review','host evidence work needs the review state, not a running or repair one');
 assert.equal((await c.next(store)).action,'review-evidence-needed');
 await c.addReviewCheck(store,'a',{id:'probe',command:process.execPath,args:['-e','process.exit(0)'],role:'probe'});
 assert.equal(c.taskOf(await store.load(),'a').status,'review','the coordinator can register the requested probe without a delegation refusal');
});
test('a task left in review is delegated again straight to checks and review, without a new worker run',async t=>{
 const {dir,store}=await fixture(t);
 await syntheticWorker(dir)(store,'a',{workspace:dir});
 const calls:string[]=[],routings:unknown[]=[];
 let workerRuns=0;
 const countingWorker=async(...args:unknown[])=>{workerRuns++;return (syntheticWorker(dir) as any)(...args);};
 const out=await delegate(store,'a',{workspace:dir},{runWorker:countingWorker as any,runReviewer:syntheticReviews(dir,[{model:'z-ai/glm-flash'}],calls,routings) as any,fetcher:noJev});
 assert.equal(out.outcome,'accepted');
 assert.equal(workerRuns,0,'the finished worker output is reused, not bought again');
 assert.deepEqual(calls,['z-ai/glm-flash']);
 assert.ok(out.trail.some(s=>s.stage==='resume-verification'));
});
test('a blocking finding from the retry drives repair rather than escalation',async t=>{
 const {dir,store}=await fixture(t);
 const calls:string[]=[],routings:unknown[]=[];
 const blocking=[{id:'f1',lens:'Spec',location:'review-loop/app.txt',scenario:'the criterion still fails',evidence:'observed expected-versus-actual',consequence:'the gap is not closed',blocking:true}];
 const runReviewer=syntheticReviews(dir,[{model:'z-ai/glm-flash',debt:true},{model:'moonshot/kimi-x',findings:blocking},{model:'z-ai/glm-flash'}],calls,routings);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:runReviewer as any,fetcher:jevGate()});
 assert.equal(out.outcome,'accepted');
 assert.deepEqual(calls,['z-ai/glm-flash','moonshot/kimi-x','z-ai/glm-flash'],'the retry defect is repaired before a fresh review');
 assert.equal(c.taskOf(await store.load(),'a').cycles,1);
});
test('a retry that cannot be routed hands the retained gap back instead of faking a verdict',async t=>{
 const {dir,store}=await fixture(t);
 const calls:string[]=[],routings:unknown[]=[];
 const runReviewer=syntheticReviews(dir,[{model:'z-ai/glm-flash',debt:true},{model:'none',pending:'route-blocked'}],calls,routings);
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:runReviewer as any,fetcher:noJev});
 assert.equal(out.outcome,'route-pending');
 assert.equal((out.route as any).action,'route-blocked');
 assert.equal(c.taskOf(await store.load(),'a').status,'review');
 assert.equal((await c.next(store)).action,'review-evidence-needed','the retained first review still reports its gap');
});
const card=(id:string,created:number)=>({id,created,context_length:64000,architecture:{input_modalities:['text']},supported_parameters:['tools'],pricing:{prompt:'0.000001',completion:'0.000002'},description:'Synthetic test card, not a capability benchmark'});
const cards=[card('z-ai/glm-new-flash',4),card('deepseek/new-flash',3),card('moonshot/kimi-specialist',5)];
const testModels={flash:['z-ai/glm-new-flash','deepseek/new-flash','moonshot/kimi-specialist'],deep:['moonshot/kimi-specialist'],jev:'typesafe/jev-1.13',providerCooldownMs:300000,providerFailovers:3,launchAttempts:3,idleTimeoutMs:900000,slowModelWindowMs:604800000,reviewerMaxTurns:60};
async function useModels(t:any,dir:string){
 const path=join(dir,'models.json');await writeFile(path,JSON.stringify(testModels));
 const old=process.env.AMALEH_MODELS;process.env.AMALEH_MODELS=path;
 t.after(()=>{if(old===undefined)delete process.env.AMALEH_MODELS;else process.env.AMALEH_MODELS=old;});
}
const gateway=()=>{const fetcher=(async()=>Response.json({data:cards})) as typeof fetch;return fetcher;};
async function routingFixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-review-route-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await useModels(t,dir);
 const oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='sk-review-loop-fixture-not-real';
 t.after(()=>{if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;});
 const store=await c.start(dir,{shape:clearCut,id:'review-route',host:{kind:'codex',model:'gpt-6-astra'},intent:'Route an independent reviewer',criteria:['A gap is retried by another family']});
 await c.plan(store,{tasks:[{id:'a',title:'a',goal:'Review actual behaviour',phase:'one',deps:[],resources:['a'],criteria:['correct amount'],checks:[],kind:'code',noProbe:'Test fixture; reviewer routing is asserted by the test, not by an executable probe'}],integrationChecks:[]});
 return {dir,store};
}
async function awaitingReview(store:c.Store,dir:string){
 await fixtureClaim(store,'a',{workspace:dir,model:'z-ai/glm-new-flash'});
 await c.result(store,'a',{});
}
test('reviewer routing excludes an additional family so the retry differs from the gap reviewer',async t=>{
 const {dir,store}=await routingFixture(t);await awaitingReview(store,dir);
 const route=await selectModel(store,'a','reviewer',dir,{excludeFamilies:['deepseek']},gateway());
 assert.equal(route.action,'launch');
 if(route.action!=='launch')throw Error('Expected launch');
 assert.equal(route.model,'moonshot/kimi-specialist','only the remaining eligible family may be offered');
 const blocked=await selectModel(store,'a','reviewer',dir,{excludeFamilies:['deepseek','kimi']},gateway());
 assert.equal(blocked.action,'route-blocked','excluding every independent family must not launch the author');
});
async function capturedReviewerPrompt(t:any){
 const {dir,store}=await routingFixture(t);await awaitingReview(store,dir);
 const outside=await mkdtemp(join(tmpdir(),'amaleh-review-prompt-'));t.after(()=>rm(outside,{recursive:true,force:true}));
 const old={fetch:globalThis.fetch,entry:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 t.after(()=>{globalThis.fetch=old.fetch;for(const [key,value] of [['AMALEH_PI_ENTRY',old.entry],['AMALEH_NODE',old.node]] as const)if(value===undefined)delete process.env[key];else process.env[key]=value;});
 const promptPath=join(outside,'reviewer-prompt.txt'),entry=join(outside,'fake-pi.ts');
 await writeFile(entry,`import {readFileSync,writeFileSync} from 'node:fs';
const prompt=process.argv.at(-1);
writeFileSync(${JSON.stringify(promptPath)},prompt);
const handoff=prompt.match(/"([^"]*review-packet\\.md)"/);
const packet=JSON.parse(readFileSync(handoff[1],'utf8').match(/\`\`\`json\\n([\\s\\S]*?)\\n\`\`\`/)[1]);
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',model:process.argv[process.argv.indexOf('--model')+1],content:[{type:'text',text:JSON.stringify({report:'Synthetic reviewer fixture',coverage:packet.obligations.map((o:any)=>({id:o.id,status:'covered',evidence:'Synthetic protocol fixture only'})),findings:[]})}],stopReason:'stop'}}));
console.log(JSON.stringify({type:'agent_end'}));`);
 process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;globalThis.fetch=gateway();
 await reviewer(store,'a',undefined,['Spec']);
 return readFile(promptPath,'utf8');
}
test('the reviewer prompt defines exactly which findings are blocking',async t=>{
 const prompt=await capturedReviewerPrompt(t);
 assert.ok(prompt.includes(blockingDefinition),'the reviewer prompt must carry the blocking definition');
 assert.match(prompt,/regression of existing behaviour/i);
 assert.match(prompt,/failed task criterion/i);
 assert.match(prompt,/false statement in documentation/i);
 assert.match(prompt,/preference/i);
});
test('the reviewer prompt asks for every blocking defect in one pass',async t=>{
 const prompt=await capturedReviewerPrompt(t);
 assert.match(prompt,/every blocking defect/i);
 assert.match(prompt,/(one|this|a single) pass/i);
 assert.doesNotMatch(prompt,/stop (at|after) the first/i);
});
