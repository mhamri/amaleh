import { mkdir, writeFile, rm, readdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { start, plan, taskOf, invariant, hash, type TaskInput } from './core.ts';
import { delegateBatch } from './delegate.ts';
import { processHealth } from './host-diagnostics.ts';
import { diagnostics } from './telemetry.ts';

type Unit = { id:string; title:string; goal:string; module:string; criteria:string[]; spec:string };

export const units:Unit[] = [
 {id:'slugify',title:'URL slug',module:'slugify.ts',goal:'Export slugify(input) turning arbitrary text into a lowercase hyphen-separated URL slug',
  criteria:['Every case in spec.test.ts passes','Only slugify.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slugify } from './slugify.ts';\ntest('lowercases and hyphenates',()=>{assert.equal(slugify('Hello World'),'hello-world');});\ntest('strips punctuation',()=>{assert.equal(slugify('Caf\\u00e9 & Bar!'),'cafe-bar');});\ntest('collapses runs of separators',()=>{assert.equal(slugify('  a---b  c '),'a-b-c');});\ntest('returns empty string for no usable characters',()=>{assert.equal(slugify('!!!'),'');});\n`},
 {id:'chunk',title:'Array chunking',module:'chunk.ts',goal:'Export chunk(items,size) splitting an array into consecutive groups of at most size',
  criteria:['Every case in spec.test.ts passes','Only chunk.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { chunk } from './chunk.ts';\ntest('splits evenly',()=>{assert.deepEqual(chunk([1,2,3,4],2),[[1,2],[3,4]]);});\ntest('keeps a short final group',()=>{assert.deepEqual(chunk([1,2,3],2),[[1,2],[3]]);});\ntest('returns no groups for an empty array',()=>{assert.deepEqual(chunk([],3),[]);});\ntest('rejects a size below one',()=>{assert.throws(()=>chunk([1],0));});\n`},
 {id:'duration',title:'Duration parsing',module:'duration.ts',goal:'Export parseDuration(text) converting a compact duration such as 1h30m into milliseconds',
  criteria:['Every case in spec.test.ts passes','Only duration.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseDuration } from './duration.ts';\ntest('reads a single unit',()=>{assert.equal(parseDuration('90s'),90000);});\ntest('sums several units',()=>{assert.equal(parseDuration('1h30m'),5400000);});\ntest('supports days and milliseconds',()=>{assert.equal(parseDuration('2d500ms'),172800500);});\ntest('rejects unparseable text',()=>{assert.throws(()=>parseDuration('soon'));});\n`},
 {id:'bytes',title:'Byte formatting',module:'bytes.ts',goal:'Export formatBytes(count) rendering a byte count with a binary unit suffix',
  criteria:['Every case in spec.test.ts passes','Only bytes.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatBytes } from './bytes.ts';\ntest('leaves small counts in bytes',()=>{assert.equal(formatBytes(512),'512 B');});\ntest('uses one decimal place for kibibytes',()=>{assert.equal(formatBytes(1536),'1.5 KB');});\ntest('drops a trailing zero decimal',()=>{assert.equal(formatBytes(1048576),'1 MB');});\ntest('rejects a negative count',()=>{assert.throws(()=>formatBytes(-1));});\n`},
 {id:'truncate',title:'Text truncation',module:'truncate.ts',
  goal:'Export truncate(text,limit) shortening text to at most limit characters, ending the shortened result with the single ellipsis character …. Whether to cut at a word boundary or mid-word is a real product trade-off that spec.test.ts deliberately leaves open: a word boundary reads better but can waste most of the budget on one long word. This has no single right answer, so consult the Jev helper before choosing and state the choice and its reason in your result',
  criteria:['Every case in spec.test.ts passes','Only truncate.ts is created or changed','The word-boundary choice was taken through the Jev helper and its reason is stated in the result'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { truncate } from './truncate.ts';\ntest('leaves text within the limit untouched',()=>{assert.equal(truncate('hello',10),'hello');});\ntest('leaves text exactly at the limit untouched',()=>{assert.equal(truncate('abc',3),'abc');});\ntest('never exceeds the limit and marks the cut',()=>{const out=truncate('the quick brown fox',10);assert.ok(out.length<=10,out+' exceeds 10 characters');assert.ok(out.endsWith('\\u2026'),out+' does not end with an ellipsis');});\ntest('rejects a limit below one',()=>{assert.throws(()=>truncate('x',0));});\n`}];

export async function prepare(workspace:string){
 const root=join(await realpath(workspace),'.amaleh','bench');
 await rm(root,{recursive:true,force:true});
 const spaces:Record<string,string>={},specs:Record<string,string>={};
 for(const unit of units){
  const dir=join(root,unit.id);
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'spec.test.ts'),unit.spec);
  const resolved=await realpath(dir);
  const contents=await readdir(resolved);
  invariant(contents.length===1&&contents[0]==='spec.test.ts',`Workspace ${resolved} is not a clean slate; it holds ${contents.join(', ')}`);
  spaces[unit.id]=resolved;specs[unit.id]=hash(unit.spec);
 }
 return {spaces,specs};
}
async function untouchedSpecs(spaces:Record<string,string>,specs:Record<string,string>){
 const edited:string[]=[];
 for(const unit of units){
  const current=await readFile(join(spaces[unit.id],'spec.test.ts'),'utf8').catch(()=>undefined);
  if(current===undefined||hash(current)!==specs[unit.id])edited.push(unit.id);
 }
 return edited;
}

const taskOfUnit=(unit:Unit):TaskInput=>({id:unit.id,title:unit.title,goal:`${unit.goal}. The file spec.test.ts already exists and must not be edited; create ${unit.module} beside it so every case passes.`,
 phase:'bench',deps:[],resources:[unit.id],criteria:unit.criteria,kind:'code',checks:[{id:'spec',command:'bun',args:['test','spec.test.ts'],role:'probe' as const}]});

export function scorecard(health:Extract<Awaited<ReturnType<typeof processHealth>>,{available:true}>,accepted:number,green:number,edited:string[],totals:Record<string,unknown>,elapsedMs:number){
 const metric=(name:string)=>Number(health.metrics[name]??0);
 const rows=[
  {name:'specs left unmodified',value:edited.length?`edited by ${edited.join(', ')}`:`${units.length}/${units.length}`,pass:edited.length===0},
  {name:'modules passing their spec',value:`${green}/${units.length}`,pass:green===units.length},
  {name:'chunks accepted',value:`${accepted}/${units.length}`,pass:accepted===units.length},
  {name:'delegated, not hand-driven',value:`${metric('delegations')} delegations for ${metric('tasks')} tasks`,pass:metric('delegations')>=metric('tasks')},
  {name:'coordinator decisions per task',value:String(metric('coordinatorDecisionsPerTask')),pass:metric('coordinatorDecisionsPerTask')<=2},
  {name:'worker-side Jev calls',value:String(metric('workerJevCalls')),pass:metric('workerJevCalls')>0},
  {name:'model families used',value:Object.keys(health.metrics.workerFamilies??{}).join(', ')||'none',pass:Object.keys(health.metrics.workerFamilies??{}).length>=2},
  {name:'health warnings',value:String(health.warnings.length),pass:health.warnings.length===0}];
 const notes=[`coordinator operations: ${metric('coordinatorOperations')}, state revisions: ${metric('revisions')}, after ${metric('retries')} recorded retries`,
  `worker dispatches: ${metric('workerDispatches')} for ${metric('tasks')} tasks`];
 return {passed:rows.filter(r=>r.pass).length,total:rows.length,rows,notes,warnings:health.warnings,cost:totals,elapsedMs};
}

export async function bench(workspace:string,runId:string,host:{kind:string;model:string}){
 invariant(host?.kind&&host?.model,'Bench needs the actual host kind and model');
 const {spaces,specs}=await prepare(workspace);
 const store=await start(workspace,{id:runId,host,intent:'Benchmark Amaleh delegation: four independent utility modules, each proven by a pre-written test file',
  criteria:['Every delegated module passes every case in its own spec.test.ts, with no spec file edited',
   'Each module is delivered in its own isolated workspace and accepted only after an independent review by another model family'],
  constraints:['Do not edit any spec.test.ts','Create only the named module in each workspace'],
  unrelated:'Fixed delegation benchmark, deliberately re-run against its own prior results'});
 await plan(store,{tasks:units.map(taskOfUnit),integrationChecks:[]});
 await store.transaction(s=>{s.config.maxWorkers=units.length;for(const unit of units)taskOf(s,unit.id).workspace=spaces[unit.id];});
 const startedAt=Date.now();
 const outcome=await delegateBatch(store,{ids:units.map(u=>u.id)});
 const elapsedMs=Date.now()-startedAt;
 const state=await store.load();
 const accepted=state.tasks.filter(t=>t.status==='accepted').length;
 const green=state.tasks.filter(t=>t.checks.length&&t.checks.every(c=>t.receipts.some(r=>r.id===c.id&&r.code===0))).length;
 const health=await processHealth(store);
 invariant(health.available,'Bench cannot score a run whose health is unreadable');
 const totals=(await diagnostics(store.root)).totals as Record<string,unknown>;
 const byModel:Record<string,{used:number;unavailable:number}>={};
 for(const e of state.events){
  const model=(e.detail as any)?.model;
  if(typeof model!=='string')continue;
  if(e.type==='claimed'||e.type==='model-routed')byModel[model]??={used:0,unavailable:0};
  if(e.type==='claimed')byModel[model]!.used++;
  if(e.type==='provider-unavailable'){byModel[model]??={used:0,unavailable:0};byModel[model]!.unavailable++;}
 }
 return {run:runId,outcomes:outcome.outcomes.map(o=>({task:o.task,outcome:o.outcome,reason:(o as {reason?:string}).reason,stage:(o as {stage?:string}).stage})),models:byModel,...scorecard(health,accepted,green,await untouchedSpecs(spaces,specs),totals,elapsedMs)};
}

export function renderScorecard(result:Awaited<ReturnType<typeof bench>>){
 const width=Math.max(...result.rows.map(r=>r.name.length));
 const lines=result.rows.map(r=>`${r.pass?'PASS':'FAIL'}  ${r.name.padEnd(width)}  ${r.value}`);
 const unreliable=Object.entries(result.models).filter(([,m])=>m.unavailable>0).sort((a,b)=>b[1].unavailable-a[1].unavailable);
 const unfinished=result.outcomes.filter(o=>o.outcome!=='accepted');
 return [`Amaleh delegation benchmark: ${result.passed}/${result.total} checks passed in ${(result.elapsedMs/1000).toFixed(1)}s`,...lines,
  '',...result.notes.map(n=>'      '+n),
  ...(unfinished.length?['','Chunks that did not close:',...unfinished.map(o=>`- ${o.task}: ${o.outcome}${o.stage?` at ${o.stage}`:''}${o.reason?` — ${o.reason}`:''}`)]:[]),
  ...(unreliable.length?['','Models that went unavailable:',...unreliable.map(([id,m])=>`- ${id}: ${m.unavailable} failure(s), ${m.used} successful dispatch(es)`)]:[]),
  ...(result.warnings.length?['','Warnings:',...result.warnings.map(w=>'- '+w)]:[])].join('\n');
}
