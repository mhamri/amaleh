import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store, taskOf, invariant, hash, family, fingerprint, event, conflict, activeTasks, unmetDependencies } from './core.ts';
import type { Run } from './core.ts';
import { catalog } from './adapters.ts';
import { loadModelConfig, configPath } from './config.ts';
import { recentSpeeds, slowModels } from './telemetry.ts';

export type RoutingRequest = { role?:string; requiredInputs?:string[]; contextTokens?:number; evidence?:string; excludeFamilies?:string[] };
type Purpose = 'worker'|'reviewer';
type Scope = { taskId:string; purpose:Purpose; workspace:string; request:RoutingRequest; content?:string };
type Grant = { action:'launch'; model:string; decisionId:string; key:string; scope:Scope };
type Route = {action:'dispatch-blocked';reason:string;tasks:string[]} | Grant | {action:'host-decision';decisionId:string} | {action:'route-blocked';reason:string;decisionId?:string} | {action:'host-takeover';model:string};

export function scopeKey(s:Run,scope:Scope){
 const t=taskOf(s,scope.taskId);
 return hash(JSON.stringify({scope,host:s.host,intent:s.intent,constraints:s.constraints,pools:s.modelPools,
  task:{id:t.id,goal:t.goal,criteria:t.criteria,checks:t.checks,kind:t.kind,deps:t.deps,resources:t.resources,status:t.status,cycles:t.cycles,depth:t.depth,author:t.author,output:t.output},
  dependencies:t.deps.map(id=>{const d=taskOf(s,id);return [id,d.status,d.integrated];})}));
}
const used=(s:Run,id:string)=>s.events.some(e=>e.type==='route-used'&&(e.detail as any).decisionId===id);
const cooling=(s:Run,model:string,cooldownMs:number,now=Date.now())=>s.events.some(e=>e.type==='provider-unavailable'&&(e.detail as any)?.model===model&&now-Date.parse(e.at)<cooldownMs);

/** Consume with the task claim in the same transaction, before any process starts. */
export function consumeRoute(s:Run,route:Grant){
 const d=s.decisions.find(d=>d.id===route.decisionId),state=d?.state as any;
 invariant(s.status==='active'&&d?.choice&&state?.routing?.key===route.key,'Resolved routing decision required');
 invariant(state.routing.models[d.choice]===route.model,'Selected model differs from routing decision');
 invariant(scopeKey(s,route.scope)===route.key,'Task or routing requirements changed; route again');
 invariant(!used(s,d.id),'Routing decision already consumed');
 event(s,'route-used',{decisionId:d.id,taskId:route.scope.taskId,purpose:route.scope.purpose,model:route.model});
}

export async function selectModel(store:Store,id:string,purpose:Purpose,workspace:string,request:RoutingRequest={},fetcher:typeof fetch=fetch):Promise<Route>{
 invariant(['worker','reviewer'].includes(purpose),'Invalid routing purpose');
 invariant(!request.role||typeof request.role==='string','Invalid routing role');
 invariant(!request.requiredInputs||(Array.isArray(request.requiredInputs)&&request.requiredInputs.every(x=>typeof x==='string')),'Invalid required input modalities');
 invariant(request.contextTokens===undefined||(Number.isInteger(request.contextTokens)&&request.contextTokens>0),'Invalid context requirement');
 invariant(request.excludeFamilies===undefined||(Array.isArray(request.excludeFamilies)&&request.excludeFamilies.every(x=>typeof x==='string'&&!!x.trim())),'Invalid excluded model families');
 const s=await store.load(),t=taskOf(s,id);
 invariant(s.status==='active','Run is not active');
 invariant(purpose==='worker'?['ready','repair'].includes(t.status):t.status==='review','Task is not ready for requested route');
 const resolvedWorkspace=await realpath(workspace);
 if(t.activity)return {action:'dispatch-blocked',reason:'Task verification already active',tasks:[id]};
 {
  const unmet=unmetDependencies(s,t);
  if(unmet.length)return {action:'dispatch-blocked',reason:'Unmet dependencies; integrate prerequisite tasks before routing',tasks:unmet};
  const live=activeTasks(s).filter(other=>other.id!==id);
  if(live.length>=s.config.maxWorkers)return {action:'dispatch-blocked',reason:'Worker capacity reached; wait for a running task',tasks:live.map(t=>t.id)};
  const conflicts=live.filter(other=>conflict({...t,workspace:resolvedWorkspace},other));
  if(conflicts.length)return {action:'dispatch-blocked',reason:'Conflicting live task; wait for resource or workspace ownership',tasks:conflicts.map(t=>t.id)};
 }
 if(purpose==='worker'&&t.depth==='host')return {action:'host-takeover',model:s.host.model};
 const scope:Scope={taskId:id,purpose,workspace:resolvedWorkspace,request,content:purpose==='reviewer'?await fingerprint(workspace):undefined};
 if(purpose==='reviewer')invariant(scope.workspace===t.workspace,'Reviewer must inspect the task workspace');
 const key=scopeKey(s,scope);
 const stale=s.decisions.filter(d=>{const r=(d.state as any)?.routing;return !used(s,d.id)&&r?.scope?.taskId===id&&r.scope.purpose===purpose&&r.key!==key;});
 if(stale.length)await store.transaction(current=>{
  invariant(scopeKey(current,scope)===key,'Task changed while invalidating its old route');
  for(const old of stale){const d=current.decisions.find(d=>d.id===old.id);if(d&&!used(current,d.id)&&d.choice!=='reassess'){d.choice='reassess';d.source='runtime:route-invalidated';d.reason='Task, workspace content or routing requirements changed; old route cannot authorize launch';event(current,'route-invalidated',{decisionId:d.id,taskId:id,purpose});}}
 });
 const existing=s.decisions.find(d=>(d.state as any)?.routing?.key===key&&!used(s,d.id));
 const resolve=(d:Run['decisions'][number]):Route=>{
  if(!d.choice)return {action:'host-decision',decisionId:d.id};
  const model=(d.state as any).routing.models[d.choice];
  return model?{action:'launch',model,decisionId:d.id,key,scope}:{action:'route-blocked',reason:'Jev/host selected reassessment; update task requirements, pool or evidence before routing again',decisionId:d.id};
 };
 if(existing)return resolve(existing);
 const pool=request.role?s.modelPools?.find(p=>p.role===request.role):s.modelPools?.find(p=>p.role===purpose);
 invariant(!request.role||pool,`No configured model pool for role ${request.role}`);
 const inputs=[...new Set(['text',...(pool?.requiredInputs??[]),...(request.requiredInputs??[])])];
 const cards=await catalog(store,fetcher);
 const config=await loadModelConfig();
 const listed=pool?pool.models:purpose==='worker'&&t.depth==='deep'?config.deep:config.flash;
 const card=new Map<string,any>(cards.models.map((m:any)=>[m.id,m]));
 const capable=(m:any)=>!!m.parameters?.includes('tools')&&inputs.every(i=>m.modalities?.includes(i))&&(!request.contextTokens||m.context>=request.contextTokens);
 const absent=listed.filter(id=>!card.has(id)),unfit=listed.filter(id=>card.has(id)&&!capable(card.get(id)));
 let eligible=listed.filter(id=>card.has(id)&&capable(card.get(id))).map(id=>card.get(id));
 if(purpose==='reviewer'){const excluded=new Set([t.family,...(request.excludeFamilies??[])]);eligible=eligible.filter((m:any)=>!excluded.has(family(m.id)));}
 const responsive=eligible.filter((m:any)=>!cooling(s,m.id,config.providerCooldownMs));
 if(responsive.length)eligible=responsive;
 const slow=config.slowModelWindowMs?slowModels(await recentSpeeds(store.amalehDir,config.slowModelWindowMs)).filter(m=>m.role===purpose):[];
 const brisk=eligible.filter((m:any)=>!slow.some(x=>x.model===m.id));
 const skippedSlow=brisk.length&&brisk.length<eligible.length?slow.filter(x=>eligible.some((m:any)=>m.id===x.model)).map(x=>({model:x.model,averageMinutes:x.averageMinutes,medianMinutes:x.medianMinutes})):[];
 if(skippedSlow.length)eligible=brisk;
 if(!eligible.length)return {action:'route-blocked',reason:`No configured model is routable for this ${purpose}. Configured in ${configPath()}: ${listed.join(', ')}.`
  +(absent.length?` Absent from the OpenRouter catalog: ${absent.join(', ')}.`:'')
  +(unfit.length?` Lacking tool support, the required input modalities (${inputs.join(', ')}) or ${request.contextTokens??0} context tokens: ${unfit.join(', ')}.`:'')
  +(purpose==='reviewer'?` A reviewer must differ from the author family ${t.family}; add a model from another family.`:'')};
 const models:Record<string,string>={},criteria:Record<string,string>={};
 eligible.forEach((m:any,i:number)=>{const option=`model_${i}`;models[option]=m.id;criteria[option]=`Use ${m.id}: meets enforced requirements (stability, tools, modalities, context).`;});
 criteria.reassess='No offered model is sufficiently suitable: revise requirements/pool or use host diagnosis. Do not invent strengths or latency.';
 const decisionId=`route-${randomUUID()}`;
 // Deterministic round-robin seeded by the run's session hash: each routing decision in this
 // run advances the rotation, so sessions distribute across eligible families instead of
 // fixating on one vendor. No Jev call is spent on mechanical model selection.
 // The rotation counter is read inside the same transaction that appends the decision:
 // concurrent routes would otherwise all observe the same count and select one model.
 const decision=await store.transaction(current=>{
  invariant(scopeKey(current,scope)===key,'Task changed during routing; request a fresh route');
  invariant(!current.decisions.some(d=>(d.state as any)?.routing?.key===key&&!used(current,d.id)),'Another route already exists; reuse it');
  const prior=current.decisions.filter(d=>(d.state as any)?.routing?.models).length;
  const index=(parseInt(hash(current.id).slice(0,8),16)+prior)%eligible.length;
  const choice=`model_${index}`;
  const state={routing:{key,models,scope},skippedSlow,rotation:{seed:'run-session-hash',priorRoutes:prior,index,eligible:eligible.length},task:{goal:t.goal,criteria:t.criteria,kind:t.kind,depth:t.depth},purpose,
   poolNotes:pool?.notes,evidence:request.evidence,catalog:{verifiedAt:cards.verifiedAt,source:cards.source,models:eligible}};
  const made={id:decisionId,question:'Deterministic round-robin rotation across eligible models, seeded by the run session hash',criteria,state,revision:current.revision,choice,source:'runtime:round-robin',confidence:1};
  current.decisions.push(made);event(current,'model-routed',{id:decisionId,taskId:id,purpose,eligible:eligible.map((m:any)=>m.id),skippedSlow:skippedSlow.map(x=>x.model),choice,model:models[choice],source:'runtime:round-robin'});
  return made;
 });
 return resolve(decision);
}

// Reconstruct grants from durable decisions; never trust a caller-supplied scope.
export function consumeWorkerRoute(s:Run,id:string,model:string,workspace:string,decisionId:string){
 const decision=s.decisions.find(d=>d.id===decisionId),routing=(decision?.state as any)?.routing;
 invariant(routing?.scope?.purpose==='worker'&&routing.scope.taskId===id&&routing.scope.workspace===workspace,'Worker route must match task and workspace');
 consumeRoute(s,{action:'launch',model,decisionId,key:routing.key,scope:routing.scope});
}
