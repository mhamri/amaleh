import {fixtureClaim,clearCut,noJev} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as c from '../scripts/core.ts';
import {delegate} from '../scripts/delegate.ts';

const task={id:'a',title:'a',goal:'Keep a chunk alive when one reviewer call fails',phase:'one',deps:[],resources:['app.txt'],criteria:['A failed reviewer call is replaced by another reviewer'],kind:'code' as const,checks:[{id:'test',command:process.execPath,args:['-e','process.exit(0)'],role:'guard' as const}],noProbe:'Test fixture; reviewer failover is asserted by the test, not by an executable probe'};
async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-reviewer-failover-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'app.txt'),'original');
 const store=await c.start(dir,{shape:clearCut,id:'failover',host:{kind:'codex',model:'gpt-6-astra'},intent:'Fail over a reviewer call that returns no verdict',criteria:['A chunk survives one failed reviewer call']});
 await c.plan(store,{tasks:[task],integrationChecks:[]});
 return {dir,store};
}
const syntheticWorker=(dir:string)=>async (store:any,id:string)=>{await fixtureClaim(store,id,{workspace:dir,model:'deepseek/flash'});await c.result(store,id,{changed:'app.txt'});return {artifact:c.taskOf(await store.load(),id).output};};
function reviews(dir:string,failures:string[],calls:number[]){
 return async (store:any,id:string)=>{
  calls.push(calls.length+1);
  const failure=failures[calls.length-1];
  if(failure)throw new Error(failure);
  const s=await store.load();
  await c.review(store,id,{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(dir),findings:[],report:'Synthetic fixture review; not a model judgment',coverage:c.reviewObligations(s,c.taskOf(s,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic fixture coverage'}))});
  return {findings:[]};
 };
}
const noVerdict=[
 'pi returned no final text for a reviewer call, whose JSON report is the reply; inspect diagnostic trace x',
 'pi incomplete: exit 0, agent_end=false; inspect diagnostic trace x',
 'Provider finish_reason: error',
];

for(const failure of noVerdict)test(`a reviewer call that fails with "${failure.slice(0,40)}" is replaced by another review`,async t=>{
 const {dir,store}=await fixture(t);
 const calls:number[]=[];
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:reviews(dir,[failure],calls) as any,fetcher:noJev});
 assert.equal(out.outcome,'accepted');
 assert.equal(calls.length,2,'exactly one replacement review');
 assert.ok(out.trail.some(s=>s.stage==='provider-failover'&&(s.detail as any).stage==='reviewer'));
});

test('reviewer failover stops at the configured budget and leaves the task in review',async t=>{
 const {dir,store}=await fixture(t);
 const calls:number[]=[];
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:reviews(dir,Array(20).fill(noVerdict[0]),calls) as any,fetcher:noJev});
 assert.equal(out.outcome,'failed');
 assert.ok(calls.length>1&&calls.length<20,'the budget bounds the replacements');
 assert.equal(c.taskOf(await store.load(),'a').status,'review','the finished worker output is kept for the next delegation');
});

test('an out-of-credits reviewer failure is not replaced by another review',async t=>{
 const {dir,store}=await fixture(t);
 const calls:number[]=[];
 const credits='402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 131072 tokens, but can only afford 29119. To increase, visit https://openrouter.ai/settings/credits and add more credits","code":402}';
 const out=await delegate(store,'a',{workspace:dir},{runWorker:syntheticWorker(dir) as any,runReviewer:reviews(dir,[credits,credits,credits],calls) as any,fetcher:noJev});
 assert.equal(out.outcome,'failed');
 assert.equal(calls.length,1,'another model cannot fix an empty account');
});

test('a worker call that fails without a verdict is not failed over by this rule',async t=>{
 const {dir,store}=await fixture(t);
 let workerCalls=0;
 const failingWorker=async()=>{workerCalls++;throw new Error(noVerdict[1]);};
 const out=await delegate(store,'a',{workspace:dir},{runWorker:failingWorker as any,runReviewer:reviews(dir,[],[]) as any,fetcher:noJev});
 assert.equal(out.outcome,'failed');
 assert.equal(workerCalls,1);
});
