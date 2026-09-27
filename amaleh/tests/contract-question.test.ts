import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from '../scripts/core.ts';
import { delegate } from '../scripts/delegate.ts';
import { processHealth } from '../scripts/host-diagnostics.ts';
import { fixtureClaim, clearCut } from './execution-fixture.ts';

const probe={id:'test',command:process.execPath,args:['-e',"try{const c=require('fs').readFileSync(require('path').join(process.cwd(),'app.txt'),'utf8');process.exit(c.includes('original')?1:0)}catch{process.exit(1)}"],role:'probe' as const};
const guard={id:'lint',command:process.execPath,args:['-e','process.exit(0)'],role:'guard' as const};
const task=(checks:c.Check[]=[probe]):c.TaskInput=>({id:'a',title:'a',goal:'Correct observable behavior',phase:'one',deps:[],resources:['a'],criteria:['correct result'],kind:'code',checks});
const question='The probe compares the clipboard exactly, but Windows returns CRLF line endings, so no correct copy can pass it';
const jevTargeted=(async()=>Response.json({model:'test/jev',answers:{selection:{type:'choice',choice:'targeted',confidence:.95,probabilities:{targeted:.95,rethink:.03,simplify:.02}}}})) as typeof fetch;

async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-contract-question-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'app.txt'),'original');
 const store=await c.start(dir,{shape:clearCut,id:'question',host:{kind:'codex',model:'gpt-6-astra'},intent:'Let a worker question a wrong contract',criteria:['a wrong check is asked about, not worked around']});
 await c.plan(store,{tasks:[task()],integrationChecks:[]});
 const checkout=await realpath(dir);await store.transaction(s=>{c.taskOf(s,'a').workspace=checkout;});
 const workers={n:0};
 const asking=(async(s:c.Store,id:string)=>{workers.n++;await fixtureClaim(s,id,{workspace:dir,model:'deepseek/flash'});await c.raiseContractQuestion(s,{taskId:id,question,check:'test'});writeFileSync(join(dir,'app.txt'),'corrected');await c.result(s,id,{changed:'app.txt'});return {artifact:c.taskOf(await s.load(),id).output};}) as any;
 const reviewer=(async(s:c.Store,id:string)=>{const state=await s.load();await c.review(s,id,{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(dir),findings:[],report:'Synthetic fixture review',coverage:c.reviewObligations(state,c.taskOf(state,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic protocol fixture only'}))});return {findings:[]};}) as any;
 return {dir,store,workers,asking,reviewer};
}

test('a worker that questions its contract stops the chunk before any check runs, without spending a repair cycle',async t=>{
 const {store,asking,reviewer}=await fixture(t);
 const out=await delegate(store,'a',{},{runWorker:asking,runReviewer:reviewer,fetcher:jevTargeted});
 assert.equal(out.outcome,'escalated');
 assert.equal(out.stage,'contract-question');
 assert.deepEqual(out.questions,[{question,check:'test'}]);
 assert.ok(!out.trail.some(s=>s.stage==='check'),'a questioned check must not run before the coordinator answers');
 const s=await store.load(),a=c.taskOf(s,'a');
 assert.equal(a.status,'review');
 assert.equal(a.cycles,0);
 assert.equal(a.review,undefined,'no model reviews an output whose contract is in question');
 const next=await c.next(store);
 assert.equal(next.action,'contract-question');
 const health=await processHealth(store);
 assert.ok(health.available&&health.metrics.contractQuestions===1);
});

test('amending only the checks answers the question and verifies the same output with no new worker run',async t=>{
 const {store,workers,asking,reviewer}=await fixture(t);
 await delegate(store,'a',{},{runWorker:asking,runReviewer:reviewer,fetcher:jevTargeted});
 await c.amend(store,{id:'a',reason:'The probe now normalises CRLF before comparing',task:task([probe,guard])});
 const s=await store.load(),a=c.taskOf(s,'a');
 assert.equal(a.status,'review','the output is kept for verification');
 assert.equal(a.cycles,0);
 assert.deepEqual(s.events.filter(e=>e.type==='contract-answered').map(e=>(e.detail as {answer:string}).answer),['amend']);
 assert.equal((s.events.findLast(e=>e.type==='contract-amended')!.detail as {answersQuestion:boolean}).answersQuestion,true);
 const out=await delegate(store,'a',{},{runWorker:asking,runReviewer:reviewer,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted',String(out.reason??''));
 assert.equal(workers.n,1);
});

test('delegating again with a brief answers that the contract stands and sends the output to verification',async t=>{
 const {store,workers,asking,reviewer}=await fixture(t);
 await delegate(store,'a',{},{runWorker:asking,runReviewer:reviewer,fetcher:jevTargeted});
 await assert.rejects(()=>delegate(store,'a',{},{runWorker:asking,runReviewer:reviewer,fetcher:jevTargeted}),/open contract question .* delegate again with a brief that says why the contract stands/);
 const out=await delegate(store,'a',{brief:'The probe stands: match the exact bytes'},{runWorker:asking,runReviewer:reviewer,fetcher:jevTargeted});
 assert.equal(out.outcome,'accepted',String(out.reason??''));
 assert.equal(workers.n,1);
 const s=await store.load();
 assert.deepEqual(s.events.filter(e=>e.type==='contract-answered').map(e=>e.detail),[{id:'a',answer:'stands',reason:'The probe stands: match the exact bytes'}]);
 assert.equal(c.contractQuestions(s,c.taskOf(s,'a')).length,0);
});

test('only a running worker may raise a contract question, about a check the task has',async t=>{
 const {store,dir}=await fixture(t);
 await assert.rejects(()=>c.raiseContractQuestion(store,{taskId:'a',question}),/raised by the worker while it runs/);
 await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});
 await assert.rejects(()=>c.raiseContractQuestion(store,{taskId:'a',question,check:'missing'}),/has no check named missing/);
 await assert.rejects(()=>c.raiseContractQuestion(store,{taskId:'a',question:'  '}),/needs the problem and its evidence/);
});

test('the worker helper records the question from the command line',async t=>{
 const {store,dir}=await fixture(t);
 await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});
 const helper=fileURLToPath(new URL('../scripts/question.ts',import.meta.url));
 const out=await new Promise<{code:number;stdout:string;stderr:string}>((done,fail)=>{const child=spawn(process.execPath,[helper,dir,'question','a',question,'test'],{stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',fail);child.on('close',code=>done({code:code??1,stdout,stderr}));});
 assert.equal(out.code,0,out.stderr);
 assert.match(out.stdout,/"recorded": true/);
 const s=await store.load();
 assert.deepEqual(c.contractQuestions(s,c.taskOf(s,'a')),[{question,check:'test'}]);
});
