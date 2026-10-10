import { mkdir, writeFile, rm, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { start, plan, taskOf, invariant, hash, execute, type TaskInput, type Run } from './core.ts';
import { delegateBatch } from './delegate.ts';
import { processHealth } from './host-diagnostics.ts';
import { diagnostics } from './telemetry.ts';

type Health=Extract<Awaited<ReturnType<typeof processHealth>>,{available:true}>;
export type ScorecardRow={name:string;value:string;pass:boolean};
export type ScenarioRun={root:string;spaces:Record<string,string>;state:Run;health:Health};
export type ModelUse={worker:number;reviewer:number;judge:number;unavailable:number};
export type Scenario={
 intent:string;
 criteria:string[];
 constraints:string[];
 fixtures:Record<string,string|{copy:string}>;
 tasks:(root:string)=>TaskInput[];
 verdict:(run:ScenarioRun)=>Promise<ScorecardRow[]>;
};

export const scenariosDir=join(dirname(fileURLToPath(import.meta.url)),'..','scenarios');
const scenarioName=/^[a-z0-9][a-z0-9-]{0,63}$/;
const contentHash=(bytes:Buffer)=>hash(bytes.toString('base64'));

export async function scenarioIds(){
 return (await readdir(scenariosDir,{withFileTypes:true})).filter(e=>e.isDirectory()&&scenarioName.test(e.name)).map(e=>e.name).sort();
}
export async function loadScenario(id:unknown){
 const ids=await scenarioIds();
 invariant(typeof id==='string'&&ids.includes(id),`Name the scenario to run in input.scenario; the pool holds: ${ids.join(', ')}`);
 return (await import(pathToFileURL(join(scenariosDir,id,'scenario.ts')).href)).default as Scenario;
}

export async function prepare(workspace:string,id:string,scenario:Scenario){
 const root=join(await realpath(workspace),'.amaleh','scenarios',id);
 await rm(root,{recursive:true,force:true});
 const fixtures:Record<string,string>={};
 for(const [path,content] of Object.entries(scenario.fixtures)){
  const target=join(root,path),bytes=typeof content==='string'?Buffer.from(content):await readFile(join(scenariosDir,id,content.copy));
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,bytes);
  fixtures[path]=contentHash(bytes);
 }
 await mkdir(root,{recursive:true});
 await commitFixtures(root);
 const tasks=scenario.tasks(root),spaces:Record<string,string>={};
 for(const t of tasks){const dir=join(root,t.id);await mkdir(dir,{recursive:true});spaces[t.id]=await realpath(dir);}
 return {root,tasks,spaces,fixtures};
}
const scenarioCommitter=['-c','user.name=Amaleh scenario','-c','user.email=scenario@amaleh.invalid','-c','init.defaultBranch=main','-c','commit.gpgsign=false'];
async function commitFixtures(root:string){
 for(const args of [['init','-q'],['add','-A'],['commit','-q','--allow-empty','-m','Scenario fixtures']]){
  const out=await execute({command:'git',args:[...scenarioCommitter,...args]},root);
  invariant(out.code===0,`Scenario folder ${root} needs Git so the scope check runs as in a real project, but git ${args[0]} failed: ${(out.stderr||out.stdout).trim()}`);
 }
}
export function modelUse(state:Run){
 const byModel:Record<string,ModelUse>={};
 const of=(model:string)=>byModel[model]??={worker:0,reviewer:0,judge:0,unavailable:0};
 for(const e of state.events){
  const detail=e.detail as {model?:unknown;purpose?:unknown};
  if(typeof detail?.model!=='string')continue;
  if(e.type==='route-used'&&(detail.purpose==='worker'||detail.purpose==='reviewer'))of(detail.model)[detail.purpose]++;
  if(e.type==='visual-judged')of(detail.model).judge++;
  if(e.type==='provider-unavailable')of(detail.model).unavailable++;
 }
 return byModel;
}
async function changedFixtures(root:string,fixtures:Record<string,string>){
 const changed:string[]=[];
 for(const [path,expected] of Object.entries(fixtures)){
  const current=await readFile(join(root,path)).catch(()=>undefined);
  if(!current||contentHash(current)!==expected)changed.push(path);
 }
 return changed;
}

export function scorecard(health:Health,tasks:number,accepted:number,green:number,changed:string[],verdict:ScorecardRow[],totals:Record<string,unknown>,elapsedMs:number){
 const metric=(name:string)=>Number(health.metrics[name]??0);
 const rows=[
  {name:'fixtures left unmodified',value:changed.length?`changed: ${changed.join(', ')}`:'all',pass:changed.length===0},
  {name:'tasks passing every check',value:`${green}/${tasks}`,pass:green===tasks},
  {name:'chunks accepted',value:`${accepted}/${tasks}`,pass:accepted===tasks},
  {name:'delegated, not hand-driven',value:`${metric('delegations')} delegations for ${metric('tasks')} tasks`,pass:metric('delegations')>=metric('tasks')},
  {name:'coordinator decisions per task',value:String(metric('coordinatorDecisionsPerTask')),pass:metric('coordinatorDecisionsPerTask')<=2},
  {name:'health warnings',value:String(health.warnings.length),pass:health.warnings.length===0},
  ...verdict];
 const notes=[`coordinator operations: ${metric('coordinatorOperations')}, state revisions: ${metric('revisions')}, after ${metric('retries')} recorded retries`,
  `worker dispatches: ${metric('workerDispatches')} for ${metric('tasks')} tasks`];
 return {passed:rows.filter(r=>r.pass).length,total:rows.length,rows,notes,warnings:health.warnings,cost:totals,elapsedMs};
}

export async function bench(workspace:string,runId:string,host:{kind:string;model:string},scenarioId:unknown){
 invariant(host?.kind&&host?.model,'Bench needs the actual host kind and model');
 const scenario=await loadScenario(scenarioId),id=scenarioId as string;
 const {root,tasks,spaces,fixtures}=await prepare(workspace,id,scenario);
 const store=await start(workspace,{id:runId,host,intent:scenario.intent,criteria:scenario.criteria,constraints:scenario.constraints,
  shape:{understanding:scenario.intent,clearCut:`Scenario ${id} of the Amaleh scenario pool fixes its tasks, checks and verdict in advance, so it has one reading`},
  unrelated:`Scenario ${id} of the Amaleh scenario pool, deliberately re-run against its own prior results`});
 await plan(store,{tasks,integrationChecks:[]});
 await store.transaction(s=>{s.config.maxWorkers=tasks.length;for(const t of tasks)taskOf(s,t.id).workspace=spaces[t.id];});
 const startedAt=Date.now();
 const outcome=await delegateBatch(store,{ids:tasks.map(t=>t.id)});
 const elapsedMs=Date.now()-startedAt;
 const state=await store.load();
 const accepted=state.tasks.filter(t=>t.status==='accepted').length;
 const green=state.tasks.filter(t=>t.checks.length&&t.checks.every(c=>t.receipts.some(r=>r.id===c.id&&r.code===0))).length;
 const health=await processHealth(store);
 invariant(health.available,'Bench cannot score a run whose health is unreadable');
 const totals=(await diagnostics(store.root)).totals as Record<string,unknown>;
 const verdict=await scenario.verdict({root,spaces,state,health});
 return {scenario:id,run:runId,outcomes:outcome.outcomes.map(o=>({task:o.task,outcome:o.outcome,reason:(o as {reason?:string}).reason,stage:(o as {stage?:string}).stage})),models:modelUse(state),...scorecard(health,tasks.length,accepted,green,await changedFixtures(root,fixtures),verdict,totals,elapsedMs)};
}

export function renderScorecard(result:Awaited<ReturnType<typeof bench>>){
 const width=Math.max(...result.rows.map(r=>r.name.length));
 const lines=result.rows.map(r=>`${r.pass?'PASS':'FAIL'}  ${r.name.padEnd(width)}  ${r.value}`);
 const unreliable=Object.entries(result.models).filter(([,m])=>m.unavailable>0).sort((a,b)=>b[1].unavailable-a[1].unavailable);
 const unfinished=result.outcomes.filter(o=>o.outcome!=='accepted');
 return [`Amaleh scenario ${result.scenario}: ${result.passed}/${result.total} checks passed in ${(result.elapsedMs/1000).toFixed(1)}s`,...lines,
  '',...result.notes.map(n=>'      '+n),
  ...(unfinished.length?['','Chunks that did not close:',...unfinished.map(o=>`- ${o.task}: ${o.outcome}${o.stage?` at ${o.stage}`:''}${o.reason?` — ${o.reason}`:''}`)]:[]),
  '','Model calls:',...Object.entries(result.models).map(([id,m])=>`- ${id}: worker ${m.worker}, reviewer ${m.reviewer}, visual judge ${m.judge}`),
  ...(unreliable.length?['','Models that went unavailable:',...unreliable.map(([id,m])=>`- ${id}: ${m.unavailable} provider failure(s) in ${m.worker+m.reviewer} worker and reviewer call(s)`)]:[]),
  ...(result.warnings.length?['','Warnings:',...result.warnings.map(w=>'- '+w)]:[])].join('\n');
}
