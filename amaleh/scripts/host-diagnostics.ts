import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,invariant,type RepairCause} from './core.ts';
import {hostUsage} from './host-usage.ts';
import {sanitize,diagnostics,modelSpeed,slowModels,recentSpeeds,readSpeedSamples,spend} from './telemetry.ts';
import {loadModelConfig} from './config.ts';
import {routedPrices} from './routing.ts';

const deepSpendShareLimit=0.3,deepSpendFloor=0.1;
const readOnlyOperations=new Set(['cli:health','cli:fingerprint','cli:html','cli:review-packet','cli:preflight','cli:catalog','cli:save']);
type TracedOperation={operation:string;outcome:string;started:string;elapsedMs:number};
const timeSpan=(o:TracedOperation)=>{const start=Date.parse(o.started);return {start,end:start+o.elapsedMs};};
// Runs traced before the detached batch process was named batch:delegate-batch
// recorded it as cli:delegate-batch too. It starts while its launcher runs and
// outlives it; a later launch inside a long batch ends first, so it is kept.
const detachedBatch=(o:TracedOperation,all:TracedOperation[])=>{
 if(o.operation!=='cli:delegate-batch')return false;const child=timeSpan(o);
 return all.some(l=>{if(l===o||l.operation!=='cli:delegate-batch')return false;const launcher=timeSpan(l);return launcher.start<=child.start&&child.start<=launcher.end&&launcher.end<=child.end;});
};
export const coordinatorOperationCount=(operations:TracedOperation[])=>operations.filter(o=>o.operation.startsWith('cli:')&&o.outcome==='success'&&!readOnlyOperations.has(o.operation)&&!detachedBatch(o,operations)).length;
const kinds=['decision','worker','review','edit','check','integration','permission','other'] as const;
const phases=['planned','permission-granted','permission-denied','started','completed','failed','skipped'] as const;
type HostAction={actionId:string;sessionId:string;kind:typeof kinds[number];phase:typeof phases[number];summary:string;next?:string;taskId?:string};
export async function recordHostAction(store:Store,input:HostAction){
 invariant(input&&typeof input.actionId==='string'&&!!input.actionId.trim()&&typeof input.sessionId==='string'&&!!input.sessionId.trim(),'Action and session IDs required');
 invariant(kinds.includes(input.kind)&&phases.includes(input.phase)&&typeof input.summary==='string'&&!!input.summary.trim(),'Valid action kind, phase and summary required');
 for(const value of [input.next,input.taskId])invariant(value===undefined||typeof value==='string','Optional fields must be strings');
 const record={schema:1,id:randomUUID(),at:new Date().toISOString(),source:'host-reported',actionId:input.actionId,sessionId:input.sessionId,kind:input.kind,phase:input.phase,summary:input.summary,next:input.next,taskId:input.taskId};
 const directory=join(store.root,'host-actions');await mkdir(directory,{recursive:true});
 await writeFile(join(directory,record.id+'.json'),JSON.stringify(sanitize(record)),{flag:'wx'});
 return {id:record.id,source:record.source};
}
export async function hostActions(store:Store){
 const directory=join(store.root,'host-actions');let files:string[];
 try{files=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {records:[],unreadable:[]};throw error;}
 const records:any[]=[],unreadable:string[]=[];
 for(const file of files.filter(f=>/^[a-f0-9-]+\.json$/.test(f))){try{const row=JSON.parse(await readFile(join(directory,file),'utf8'));invariant(row?.schema===1&&typeof row.id==='string'&&typeof row.actionId==='string'&&typeof row.sessionId==='string'&&typeof row.at==='string'&&kinds.includes(row.kind)&&phases.includes(row.phase),'Invalid ledger record');records.push(row);}catch{unreadable.push(file);}}
 records.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));return {records,unreadable};
}
type ReopenEvent={type:string;detail:unknown};
// Runs saved before `kind` existed: amend always wrote contract-amended as the very next event.
const reopenKind=(event:ReopenEvent,following?:ReopenEvent)=>{
 const detail=event.detail as {id?:string;kind?:string;feedback?:number};
 if(detail.kind)return detail.kind;
 if(detail.feedback!==undefined)return 'feedback';
 return following?.type==='contract-amended'&&(following.detail as {id?:string}).id===detail.id?'contract':'defect';
};
// Process health: measurable anti-patterns that reveal the coordinator doing
// the work itself instead of delegating, or model usage fixating on one family.
export async function processHealth(store:Store):Promise<{available:false;reason:string}|{available:true;slowModels:string[];metrics:Record<string,unknown>;warnings:string[]}> {
 const runtime=await diagnostics(store.root),ledger=await hostActions(store);
 let s:Awaited<ReturnType<Store['load']>>;
 try{s=await store.load();}catch(error){return {available:false,reason:(error as Error).message};}
 const tasks=s.tasks.length;
 const isRouting=(d:any)=>(d.state as any)?.routing?.models;
 const coordinatorDecisions=s.decisions.filter((d:any)=>!isRouting(d)&&d.artifact);
 const hostDecisions=s.decisions.filter((d:any)=>String(d.source??'').startsWith('host:'));
 const workerJev=s.events.filter(e=>e.type==='worker-jev');
 const delegations=s.events.filter(e=>e.type==='delegate-started');
 const claims=s.events.filter(e=>e.type==='claimed');
 const hostTakeovers=s.events.filter(e=>e.type==='host-exception-used');
 const hostTakeoversByTask:Record<string,number>={};
 for(const e of hostTakeovers){const task=String((e.detail as {id?:string}).id);hostTakeoversByTask[task]=(hostTakeoversByTask[task]??0)+1;}
 const families:Record<string,number>={};
 for(const e of claims){const model=(e.detail as any)?.model;if(typeof model==='string'){const f=model.split('/')[0];families[f]=(families[f]??0)+1;}}
 const dominant=Object.entries(families).sort((a,b)=>b[1]-a[1])[0];
 const perTask=(n:number)=>Number((n/Math.max(tasks,1)).toFixed(2));
 const retries=s.events.filter(e=>e.type==='provider-failover'||e.type==='repair').length;
 const coordinatorOperations=coordinatorOperationCount(runtime.operations);
 const contractQuestions=s.events.filter(e=>e.type==='contract-question').length;
 const unstableChecks=s.events.filter(e=>e.type==='check-unstable').length;
 const loopSteps=['cli:worker','cli:reviewer','cli:repair','cli:accept'];
 const manualSteps=runtime.operations.filter(o=>loopSteps.includes(o.operation)).length;
 const reopened=s.events.filter((e,i)=>e.type==='invalidated'&&reopenKind(e,s.events[i+1])==='defect').length;
 const config=await loadModelConfig().catch(()=>undefined),windowMs=config?.slowModelWindowMs??0;
 const costs=spend(runtime.operations,routedPrices(s)),estimatedTotal=costs.total?.estimatedCost??0;
 const deepSpend=costs.byModel.filter(r=>config?.deep.includes(r.key)),deepCost=deepSpend.reduce((total,r)=>total+r.estimatedCost,0),deepShare=estimatedTotal?deepCost/estimatedTotal:0;
 const speeds=windowMs?await recentSpeeds(store.amalehDir,windowMs):modelSpeed(await readSpeedSamples(store.amalehDir)),slow=slowModels(speeds,config?.flash??[]);
 const skipNote=(role:string)=>windowMs?` Routing skips it as ${role} while this holds over the last ${Math.round(windowMs/86400000*10)/10} day(s), unless no other model is eligible.`:' slowModelWindowMs is 0, so routing still uses it.';
 const about=(e:{detail:unknown})=>e.detail as {id?:string;cause?:RepairCause;sameDefect?:boolean;followUp?:boolean;verdict?:string;effort?:string};
 const repairs=s.events.filter(e=>e.type==='repair'),causes=repairs.map(e=>about(e).cause);
 const repairsByCheck:Record<string,number>={};
 for(const cause of causes)for(const check of cause?.failingChecks??[])repairsByCheck[check]=(repairsByCheck[check]??0)+1;
 const repairCauses={afterFailedCheck:causes.filter(c=>c?.failingChecks.length).length,afterReview:causes.filter(c=>c&&!c.failingChecks.length).length,notRecorded:causes.filter(c=>!c).length,sameDefectAgain:repairs.filter(e=>about(e).sameDefect).length,byCheck:repairsByCheck};
 const settled=s.events.filter(e=>e.type==='finding-settled');
 const reviews={total:s.events.filter(e=>e.type==='review').length,ofRepairOnly:s.events.filter(e=>e.type==='review-session'&&about(e).followUp).length,light:s.events.filter(e=>e.type==='review-session'&&about(e).effort==='light').length,findingsSettledNotBlocking:settled.filter(e=>about(e).verdict==='not-blocking').length,findingsHandedToOwner:settled.filter(e=>about(e).verdict==='other-owner').length};
 const firstPassAccepted=s.tasks.filter(t=>t.status==='accepted'&&!s.events.some(e=>(e.type==='repair'||e.type==='invalidated')&&about(e).id===t.id)).length;
 const span=s.events.map(e=>Date.parse(e.at)).filter(Number.isFinite);
 const mainModel=await hostUsage(s.host,s.workspace,Math.min(...span),s.status==='complete'?Math.max(...span):Date.now());
 const read=(u:{inputTokens:number;cacheReadTokens:number;cacheWriteTokens:number})=>u.inputTokens+u.cacheReadTokens+u.cacheWriteTokens,millions=(n:number)=>(n/1e6).toFixed(2);
 const workerRead=costs.total?read(costs.total):0;
 const warnings:string[]=[];
 if(mainModel.available&&workerRead>0&&read(mainModel)>workerRead)warnings.push(`The main model read ${millions(read(mainModel))} million tokens over ${mainModel.turns} turn(s) in this run; every worker and reviewer together read ${millions(workerRead)} million. Each main-model turn reads the whole conversation again, so the turn count is the cost. Run drive: it batches, waits and integrates in one command, and returns only when the main model is needed.`);
 if(tasks&&coordinatorDecisions.length>2*tasks)warnings.push(`${coordinatorDecisions.length} coordinator-authored Jev decisions across ${tasks} task(s): micro-decision pattern. Delegate chunks and let workers consult Jev through the worker helper.`);
 if(claims.length>0&&delegations.length===0)warnings.push(`${claims.length} worker dispatch(es) without any delegate run: the coordinator is stepping through the worker→check→review→repair loop manually instead of delegating the chunk.`);
 if(coordinatorDecisions.length>0&&workerJev.length===0)warnings.push('All semantic decisions were made by the coordinator; none by workers. In-task choices belong to the worker-side Jev helper.');
 if(ledger.records.length>6*Math.max(tasks,1))warnings.push(`${ledger.records.length} host-action records across ${tasks} task(s): recording ceremony is eating coordinator context.`);
 if(claims.length>=3&&dominant&&dominant[1]/claims.length>0.8)warnings.push(`Model usage is fixated on ${dominant[0]} (${dominant[1]}/${claims.length} dispatches): round-robin routing should distribute across eligible families.`);
 if(tasks&&delegations.length&&manualSteps>tasks)warnings.push(`${manualSteps} worker, reviewer, repair and accept call(s) made by hand across ${tasks} task(s): the coordinator is stepping the chunk loop itself between delegations. Re-delegate the chunk instead.`);
 if(tasks&&reopened>=Math.max(2,Math.ceil(tasks/2)))warnings.push(`${reopened} invalidation(s) reopened chunks across ${tasks} task(s): the coordinator is finding defects the chunks' own checks cannot see, and each reopening costs a repair cycle and a full chunk round. Register the probe you judge by as a task check before delegating.`);
 if(tasks===1&&s.criteria.length>=3&&!s.events.some(e=>e.type==='single-chunk'))warnings.push(`One task carries ${s.criteria.length} run outcomes: nothing can run in parallel. Split the work into independent chunks, or record a single-chunk reason.`);
 if(deepShare>deepSpendShareLimit&&estimatedTotal>=deepSpendFloor)warnings.push(`${deepSpend.map(r=>r.key).join(', ')} took ${Math.round(deepShare*100)}% of the $${estimatedTotal.toFixed(2)} estimated spend across ${deepSpend.reduce((n,r)=>n+r.calls,0)} call(s). Deep repairs come from repeated reopens and failed repairs: find the check each chunk is missing instead of paying the deep model to guess.`);
 const slowNotes=slow.map(m=>`${m.model} as ${m.role} averages ${m.averageMinutes} min per call over ${m.calls} calls, ${m.times}× the ${m.medianMinutes} min median for that role: ${m.outputTokensPerSecond} output tokens per second and ${m.outputTokensPerCall} output tokens per call.${skipNote(m.role)}`);
 return {available:true,slowModels:slowNotes,metrics:{modelSpeed:speeds,tasks,coordinatorDecisions:coordinatorDecisions.length,hostDecisions:hostDecisions.length,workerJevCalls:workerJev.length,delegations:delegations.length,workerDispatches:claims.length,manualLoopSteps:manualSteps,reopenedChunks:reopened,hostTakeovers:hostTakeovers.length,hostTakeoversByTask,hostActionRecords:ledger.records.length,contractQuestions,unstableChecks,revisions:s.revision,coordinatorOperations,retries,coordinatorDecisionsPerTask:perTask(coordinatorDecisions.length),hostActionsPerTask:perTask(ledger.records.length),coordinatorOperationsPerTask:perTask(coordinatorOperations),workerFamilies:families,firstPassAccepted,repairCauses,reviews,mainModel,cost:runtime.totals,spend:costs},warnings};
}
// Shareable by explicit user choice: omit all free text, paths, models, raw
// identifiers, prompts, artifact bodies and original exception messages.
export async function exportDiagnostics(store:Store){
 const ledger=await hostActions(store),runtime=await diagnostics(store.root);
 const aliases=(prefix:string)=>{const map=new Map<string,string>();return (value:string)=>{if(!map.has(value))map.set(value,`${prefix}-${map.size+1}`);return map.get(value)!;};};
 const action=aliases('action'),session=aliases('session');
 const safeNumber=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;
 let state:Record<string,unknown>={available:false};
 try{const run=await store.load();state={available:true,revision:safeNumber(run.revision),status:['active','blocked','complete'].includes(run.status)?run.status:'unknown',tasks:run.tasks.map((t,i)=>({task:`task-${i+1}`,status:['ready','running','review','repair','accepted','blocked'].includes(t.status)?t.status:'unknown',cycles:safeNumber(t.cycles),hasReview:!!t.review,checks:t.receipts.length}))};}catch{}
 const bundle={schema:1,createdAt:new Date().toISOString(),redaction:'structural allowlist; free text and source identifiers omitted',limitations:['Host actions are attestations, not automatic hooks.','Absent events cannot establish that an action was skipped.','Same-timestamp observations have no guaranteed causal order.'],state,
  hostActions:ledger.records.map(r=>({action:action(r.actionId),session:session(r.sessionId),kind:r.kind,phase:r.phase})),unreadableHostRecords:ledger.unreadable.length,
  operations:runtime.operations.map((o,i)=>({operation:`operation-${i+1}`,outcome:o.outcome==='success'?'success':o.outcome==='failed'?'failed':'unfinished-or-other',elapsedMs:safeNumber(o.elapsedMs),stages:o.events.length})),unreadableRuntimeRecords:runtime.unreadable.length,
  totals:Object.fromEntries(Object.entries(runtime.totals).map(([k,v])=>[k,safeNumber(v)]))};
 const dir=join(store.root,'exports');await mkdir(dir,{recursive:true});const path=join(dir,randomUUID()+'.json');await writeFile(path,JSON.stringify(bundle,null,2),{flag:'wx'});return {path,bundle};
}
