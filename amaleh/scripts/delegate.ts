// See references/runtime.md (delegate) and references/review.md#the-jev-gate
import { hostname } from 'node:os';
import { Store, taskOf, invariant, check, repair, accept, fingerprint, family, scopeCheckId, event, reviewCoverageDebt, openDelegations, next, requireShaped, execute, hostAuthored, scopeQuestion, askedScopePaths, answerScopeQuestion, unmetDependencies, contractQuestions, answerContractQuestions, keptForUpstream, runCommitMissingFromCheckout, refreshCheckoutReason, unstableChecks, jevTaskContext, settleFindings, findingOwner, lastRepairCause, openDrive, type Check, type Task, type Finding, type FindingSettlement, type FindingVerdict } from './core.ts';
import { worker, reviewer, requestJson, choiceAnswerFor, blockingDefinition, transientProvider, settledProviderFailure, taskDiff, trackedContent, WorkspaceEscape, CallStopped } from './adapters.ts';
import type { RoutingRequest } from './routing.ts';
import { jevModel, loadModelConfig } from './config.ts';
import { inScope, resourceSetsOverlap } from './resources.ts';
export { scopeCheckId };

type DelegateDeps = { runWorker:typeof worker; runReviewer:typeof reviewer; runCheck:typeof check; fetcher?:typeof fetch };
type DelegateOutcome = { task:string; trail:Trail; outcome:string; [key:string]:unknown };
const real:DelegateDeps = { runWorker:worker, runReviewer:reviewer, runCheck:check };
type Trail = { stage:string; detail:unknown }[];
const routePending = (r:unknown) => r && typeof r==='object' && 'action' in r && (r as any).action!=='launch' ? r as {action:string;model?:string} : undefined;
const hostTakeover=(model:string)=>({outcome:'escalated',stage:'host-takeover',model,reason:'The task is at host depth: take it over under host-exception. Host work is final, so the next delegate runs its checks and accepts it with no model review'});
const pendingOutcome=(pending:{action:string;model?:string})=>pending.action==='host-takeover'?hostTakeover(pending.model!):{outcome:'route-pending',route:pending};
const resumableReview=(t:Task)=>t.status==='review'&&!!t.output&&!t.activity&&!t.owner;
const escapedPaths=(error:unknown)=>error instanceof WorkspaceEscape?error.paths:undefined;

const courses={
 targeted:'Apply the smallest correct fixes that resolve each listed defect',
 rethink:'The current approach is likely wrong; reconsider the design before editing further',
 simplify:'The implementation is too complex; reduce to the minimal contract-satisfying change'};
const progress={
 new:'Every defect listed now differs from every defect of the previous round',
 same:'At least one defect listed now is the same defect as one of the previous round: the last repair did not remove it'};
const verdicts={
 'fix-here':'A blocking defect that a worker on this task must fix: it meets the blocking definition, and it sits in this task\'s resources or this task\'s own changes cause it',
 'other-owner':'A real defect, but it sits in a file outside this task\'s resources and this task\'s changes did not cause it, so the owner of that file must fix it',
 'not-blocking':'Not blocking under the blocking definition: a preference, a style choice, an optional improvement or a hypothetical requirement'};
const gateConfidence=.85,gatedFindings=12;
type Gate={course?:{choice:string;confidence?:number;meaning:string};sameDefect:boolean;settlements:FindingSettlement[]};
// See references/review.md#the-jev-gate
async function repairGate(store:Store,id:string,failing:string[],fetcher?:typeof fetch):Promise<Gate|undefined>{
 try{
  const s=await store.load(),t=taskOf(s,id),previousRound=lastRepairCause(s,id);
  const open=(t.review?.findings??[]).map((finding,index)=>({finding,index})).filter(x=>x.finding.blocking&&x.finding.disposition==='open').slice(0,gatedFindings);
  const ask=(instructions:string,criteria:Record<string,string>)=>({type:'choice',instructions,criteria});
  const questions={
   course:ask('Which repair course is most likely to resolve these verification failures without adding scope?',courses),
   ...(previousRound?{progress:ask('Compare the defects listed now with previousRound. Did the last repair remove every defect of the previous round?',progress)}:{}),
   ...Object.fromEntries(open.map(x=>[`finding_${x.index}`,ask(`Judge the finding with index ${x.index} in findings against blockingDefinition and its fileOwner.`,verdicts)]))};
  const state={...jevTaskContext(s,t),blockingDefinition,otherTasks:s.tasks.filter(o=>o.id!==t.id).map(o=>({id:o.id,resources:o.resources})),findings:open.map(x=>({index:x.index,...x.finding,fileOwner:findingOwner(s,t,x.finding).owner})),failingChecks:failing,previousRound};
  const raw=await requestJson('https://openrouter.ai/api/alpha/decisions',{model:await jevModel(),state,questions},fetcher,store.root);
  const answer=(key:string,criteria:Record<string,string>,threshold?:number)=>{try{return choiceAnswerFor(raw,key,criteria,threshold);}catch{return undefined;}};
  const course=answer('course',courses);
  const settlements=open.flatMap(x=>{const verdict=answer(`finding_${x.index}`,verdicts,gateConfidence);return verdict?.choice&&verdict.choice!=='fix-here'?[{index:x.index,verdict:verdict.choice as FindingVerdict,confidence:verdict.confidence}]:[];});
  return {course:course?.choice?{choice:course.choice,confidence:course.confidence,meaning:courses[course.choice as keyof typeof courses]}:undefined,sameDefect:answer('progress',progress,gateConfidence)?.choice==='same',settlements};
 }catch{return undefined;}
}

async function passingProbes(checks:Check[],workspace:string){
 const passing:string[]=[];
 for(const probe of checks.filter(c=>c.role==='probe')){
  let code:number;try{code=(await execute(probe,workspace)).code;}catch{code=1;}
  if(code===0)passing.push(probe.id);
 }
 return passing;
}

const repairBrief=(findings:unknown[],failing:string[],guidance?:{confidence?:number;meaning:string},scope?:string,coordinator?:string)=>
 `Repair this task: verification failed. ${guidance?`Course guidance (Jev, confidence ${guidance.confidence}): ${guidance.meaning}`:'Apply the smallest correct fixes.'}${coordinator?`\nCoordinator guidance for this chunk: ${coordinator}`:''}\nBlocking review findings: ${JSON.stringify(findings)}\nFailing checks: ${JSON.stringify(failing)}${scope?`\nOut-of-scope changed paths (scope check):\n${scope}\nRevert every path outside the task's resources, or redo the work inside them`:''}\nResolve every listed defect, keep the task contract and scope, and do not run checks yourself; verification follows automatically. Consult the Jev helper for uncertain choices as instructed.`;

type ScopeVerdict={ran:boolean;code:number;outOfScope:string[];changedPaths:string[];resources:string[];fingerprint:string;reason?:string};
export async function scopeVerdict(store:Store,id:string,fingerprint:string,mainWorkspace?:string):Promise<ScopeVerdict>{
 const s=await store.load(),t=taskOf(s,id),workspace=t.workspace!;
 const diff=mainWorkspace===undefined?undefined:await taskDiff(mainWorkspace,workspace);
 if(!diff)return {ran:false,code:0,outOfScope:[],changedPaths:[],resources:t.resources,fingerprint,reason:`no Git diff is available for ${workspace}; the scope check could not run`};
 const changedPaths=[...new Set([...diff.paths,...diff.untracked].map(p=>p.replace(/\\/g,'/')))];
 const outOfScope=changedPaths.filter(p=>!t.resources.some(r=>inScope(r,p)));
 return {ran:true,code:outOfScope.length?1:0,outOfScope,changedPaths,resources:t.resources,fingerprint};
}
async function recordScope(store:Store,id:string,verdict:ScopeVerdict){
 const stdout=verdict.outOfScope.length?`Changed paths outside the task's resources:\n${verdict.outOfScope.map(p=>`- ${p}`).join('\n')}\nRevert them or bring the work inside the task's resources.`:'Every changed path is inside the task\'s resources.';
 const artifact=await store.artifact({command:{command:scopeCheckId,args:[]},resources:verdict.resources,changedPaths:verdict.changedPaths,outOfScope:verdict.outOfScope,code:verdict.code,stdout,stderr:''});
 await store.transaction(s=>{
  const t=taskOf(s,id);const prior=t.receipts.findIndex(r=>r.id===scopeCheckId);if(prior>=0)t.receipts.splice(prior,1);
  t.receipts.push({id:scopeCheckId,code:verdict.code,fingerprint:verdict.fingerprint,artifact});event(s,'check',{id,checkId:scopeCheckId,code:verdict.code,artifact});
  const asked=askedScopePaths(s,id);
  if(!hostAuthored(t)&&verdict.outOfScope.some(p=>!asked.has(p)))event(s,'scope-question',{id,fingerprint:verdict.fingerprint,outOfScope:verdict.outOfScope});
 });
 return stdout;
}

// See references/runtime.md#check-isolation
async function confirmAlone(store:Store,id:string,checkId:string,failed:{fingerprint:string;artifact:string},d:DelegateDeps,trail:Trail,pass:number){
 const alone=await d.runCheck(store,id,checkId,{isolated:true});
 trail.push({stage:'check',detail:{check:checkId,code:alone.code,pass,isolated:true}});
 if(alone.code===0&&alone.fingerprint===failed.fingerprint)await store.transaction(s=>event(s,'check-unstable',{id,checkId,fingerprint:alone.fingerprint,failed:failed.artifact,passed:alone.artifact}));
 return alone;
}

// A check that writes into the workspace invalidates its own receipt and every
// earlier one, and acceptance compares receipts against the current tree. Re-run
// until every receipt matches the tree the checks leave behind.
const checkSettlePasses=3;
async function recordFailover(store:Store,id:string,stage:'worker'|'reviewer',trail:Trail,heldStatus:Task['status'],attempt:number,reason:string,excludedFamily?:string){
 const detail={stage,attempt,reason,...(excludedFamily?{excludedFamily}:{})};
 await store.transaction(s=>{const t=taskOf(s,id);t.status=heldStatus;t.blocked=undefined;t.owner=undefined;t.activity=undefined;event(s,'provider-failover',{id,...detail});});
 trail.push({stage:'provider-failover',detail});
}
async function consumedFamily(store:Store,id:string,purpose:'worker'|'reviewer',from:number){
 const s=await store.load();
 const consumed=s.events.slice(from).filter(e=>e.type==='route-used'&&(e.detail as {taskId?:string}).taskId===id&&(e.detail as {purpose?:string}).purpose===purpose);
 const model=(consumed.at(-1)?.detail as {model?:string}|undefined)?.model;
 return model?family(model):undefined;
}
const excluding=(routing:RoutingRequest|undefined,families:string[])=>families.length?{...routing,excludeFamilies:[...new Set([...(routing?.excludeFamilies??[]),...families])]}:routing;
// See references/runtime.md#worker-failover
async function workerFailover<T>(store:Store,id:string,trail:Trail,workspace:string,routing:RoutingRequest|undefined,stalled:string[],attempt:(routing:RoutingRequest|undefined)=>Promise<T>):Promise<T>{
 const budget=(await loadModelConfig()).providerFailovers;
 for(let n=1;;n++){
  const state=await store.load(),heldStatus=taskOf(state,id).status,cursor=state.events.length,before=await trackedContent(workspace);
  try{return await attempt(excluding(routing,stalled));}
  catch(error){
   const reason=(error as Error).message;
   if(error instanceof WorkspaceEscape||n>=budget)throw error;
   const stoppedIdle=error instanceof CallStopped&&await trackedContent(workspace)===before;
   if(!stoppedIdle&&!transientProvider(reason))throw error;
   const failed=stoppedIdle?await consumedFamily(store,id,'worker',cursor):undefined;
   if(failed&&!stalled.includes(failed))stalled.push(failed);
   await recordFailover(store,id,'worker',trail,heldStatus,n,reason,failed);
  }
 }
}
const reviewFailureIsTerminal=(error:unknown)=>error instanceof WorkspaceEscape||settledProviderFailure((error as Error).message);
async function reviewFailover<T>(store:Store,id:string,trail:Trail,routing:RoutingRequest|undefined,attempt:(routing:RoutingRequest|undefined)=>Promise<T>):Promise<T>{
 const budget=(await loadModelConfig()).providerFailovers;
 let current=routing;
 for(let n=1;;n++){
  const state=await store.load(),heldStatus=taskOf(state,id).status,cursor=state.events.length;
  try{return await attempt(current);}
  catch(error){
   const reason=(error as Error).message;
   if(reviewFailureIsTerminal(error)||n>=budget)throw error;
   const failed=await consumedFamily(store,id,'reviewer',cursor);
   if(failed&&!current?.excludeFamilies?.includes(failed))current={...(current??{}),excludeFamilies:[...(current?.excludeFamilies??[]),failed]};
   await recordFailover(store,id,'reviewer',trail,heldStatus,n,reason);
  }
 }
}
export async function delegate(store:Store,id:string,input:{workspace?:string;brief?:string;routing?:RoutingRequest;lenses?:string[];skills?:string[];references?:string[]}={},deps:Partial<DelegateDeps>={}):Promise<DelegateOutcome>{
 const d:DelegateDeps={...real,...deps};
 const trail:Trail=[],stalled:string[]=[],settledFindings:Awaited<ReturnType<typeof settleFindings>>=[];
 await store.transaction(s=>{requireShaped(s,'delegate');const t=taskOf(s,id);invariant(['ready','repair'].includes(t.status)||resumableReview(t),'Task is not delegable; reconcile or requeue it first');invariant(t.workspace||input.workspace,'Task workspace required');const brief=input.brief?.trim();invariant(!contractQuestions(s,t).length||brief,`Task ${id} has an open contract question from its worker. Amend the contract, or delegate again with a brief that says why the contract stands`);answerScopeQuestion(s,t,'revert');answerContractQuestions(s,t,'stands',brief!);event(s,'delegate-started',{id,pid:process.pid,host:hostname()});});
 const resumeAtVerification=resumableReview(taskOf(await store.load(),id));
 const finish=async(outcome:Record<string,unknown>):Promise<DelegateOutcome>=>{await store.transaction(s=>event(s,'delegate-finished',{id,outcome:outcome.outcome})).catch(()=>{});return {task:id,trail,outcome:String(outcome.outcome),...(settledFindings.length?{settledFindings}:{}),...outcome};};
 const acceptChunk=async(detail:Record<string,unknown>)=>{await accept(store,id);const s=await store.load(),done=taskOf(s,id),unstable=[...new Set(unstableChecks(s,id,done.fingerprint).map(u=>u.checkId))];return finish({outcome:'accepted',cycles:done.cycles,author:done.author,fingerprint:done.fingerprint,...(unstable.length?{unstableChecks:unstable}:{}),...detail});};
 const s0=await store.load(),t0=taskOf(s0,id),unmet=unmetDependencies(s0,t0);
 if(resumeAtVerification&&unmet.length)return finish({outcome:'route-pending',route:{action:'dispatch-blocked',reason:'Unmet dependencies; integrate prerequisite tasks before verifying this chunk again',tasks:unmet}});
 const runCommit=resumeAtVerification&&keptForUpstream(s0,t0)?await runCommitMissingFromCheckout(s0,t0):undefined;
 if(runCommit)return finish({outcome:'escalated',stage:'refresh-checkout',workspace:t0.workspace,runCommit,reason:refreshCheckoutReason(t0,runCommit)});
 if(!resumeAtVerification&&t0.depth==='host')return finish(hostTakeover(s0.host.model));
 if(t0.status==='ready'&&!t0.output){
  const passing=await passingProbes(t0.checks,input.workspace??t0.workspace!);
  if(passing.length)return finish({outcome:'refused',passing,reason:`Probe check${passing.length>1?'s':''} ${passing.join(', ')} already pass${passing.length===1?'es':''} on the unchanged checkout; a probe that passes there cannot detect the task defect, so no worker is launched`});
 }
 try{
  let out:unknown,pending:{action:string}|undefined;
  if(resumeAtVerification)trail.push({stage:'resume-verification',detail:{output:taskOf(await store.load(),id).output}});
  else{
   const workspace=input.workspace??t0.workspace!;
   try{out=await workerFailover(store,id,trail,workspace,input.routing,stalled,routing=>d.runWorker(store,id,{workspace,brief:input.brief,routing,skills:input.skills,references:input.references}));}
   catch(error){const escaped=escapedPaths(error);if(!escaped)throw error;trail.push({stage:'worker',detail:{workspaceEscape:escaped}});return finish({outcome:'escalated',stage:'workspace-escape',escaped,reason:(error as Error).message});}
   trail.push({stage:'worker',detail:out});
   pending=routePending(out);if(pending)return finish(pendingOutcome(pending));
  }
  for(;;){
   let s=await store.load(),t=taskOf(s,id);
   const questions=contractQuestions(s,t);
   if(questions.length)return finish({outcome:'escalated',stage:'contract-question',questions,workerOutput:t.output,
    reason:'The worker says the task contract is wrong and stopped instead of working around it, so no check runs until you answer. Amend the contract: that spends no repair cycle, and an amendment that changes only checks or resources keeps this output for verification. Or delegate again with a brief that says why the contract stands: the checks and review then judge the output as it stands, and a repair they need spends a cycle'});
   let mutating:string[]=[],settled=false,scopeNoted=false,recordedScope=t.receipts.find(r=>r.id===scopeCheckId)?.fingerprint;
   for(let pass=1;pass<=checkSettlePasses&&!settled;pass++){
    s=await store.load();t=taskOf(s,id);
    const fp=await fingerprint(t.workspace!);
    mutating=[];
    for(const c of t.checks){
     const r=t.receipts.find(r=>r.id===c.id),current=!!r&&r.fingerprint===fp;
     if(current&&(r.code===0||r.isolated))continue;
     const shared=current?undefined:await d.runCheck(store,id,c.id);
     if(shared)trail.push({stage:'check',detail:{check:c.id,code:shared.code,pass}});
     const alone=shared?.code===0?undefined:await confirmAlone(store,id,c.id,shared??r!,d,trail,pass);
     if(shared?.changed||alone?.changed)mutating.push(c.id);
    }
    s=await store.load();t=taskOf(s,id);
    const current=await fingerprint(t.workspace!);
    const scope=await scopeVerdict(store,id,current,s.workspace);
    if(scope.ran&&recordedScope!==scope.fingerprint){
     await recordScope(store,id,scope);
     recordedScope=scope.fingerprint;
     trail.push({stage:'scope',detail:{code:scope.code,outOfScope:scope.outOfScope}});
    }else if(!scope.ran&&!scopeNoted){
     scopeNoted=true;
     await store.transaction(x=>event(x,'scope-unverified',{id,reason:scope.reason}));
     trail.push({stage:'scope',detail:{ran:false,reason:scope.reason}});
    }
    settled=t.checks.every(c=>t.receipts.some(r=>r.id===c.id&&r.fingerprint===current))&&(!scope.ran||recordedScope===current);
   }
   if(!settled)return finish({outcome:'escalated',stage:'unstable-checks',mutating,
    reason:`Checks never settled: ${mutating.length?mutating.join(', ')+' rewrite the workspace every run, so no receipt can match the tree acceptance compares against':'the workspace keeps changing between check runs'}. Register a check that leaves the tree unchanged, or exclude its generated output from the task workspace.`});
   s=await store.load();t=taskOf(s,id);
   const failing=t.receipts.filter(r=>r.code!==0).map(r=>r.id);
   if(hostAuthored(t)){
    if(!failing.length)return acceptChunk({hostFinal:true});
    await repair(store,id);
    return finish({outcome:'escalated',stage:'host-checks-failed',failingChecks:failing,reason:'Host work is final and no model reviews it, so a failing check returns it to the host without spending a repair cycle'});
   }
   const question=scopeQuestion(s,t);
   if(question)return finish({outcome:'escalated',stage:'scope-question',outOfScope:question.outOfScope,failingChecks:failing,workerOutput:t.output,
    reason:`The worker changed ${question.outOfScope.length} path(s) outside the task's resources. Amend resources to keep them, and the next delegate verifies this same output with no new worker run; or delegate again, and a repair reverts them`});
   let blocking:Finding[]=[],gate:Gate|undefined;
   const openBlocking=async()=>{s=await store.load();t=taskOf(s,id);return t.review?.findings.filter(f=>f.blocking&&f.disposition==='open')??[];};
   const judge=async()=>{
    gate=await repairGate(store,id,failing,d.fetcher);
    if(!gate)return;
    const settled=gate.settlements.length?await settleFindings(store,id,gate.settlements):[];
    settledFindings.push(...settled);
    trail.push({stage:'jev-gate',detail:{course:gate.course?.choice,confidence:gate.course?.confidence,sameDefect:gate.sameDefect,settled:settled.map(x=>({id:x.finding.id,verdict:x.verdict,owner:x.owner}))}});
    blocking=await openBlocking();
   };
   if(failing.length)await judge();
   else{
    const lenses=input.lenses??['Spec','Standards','Correctness','Omissions'];
    const obtainReview=async(excludeFamilies:string[]=[])=>{
     const routing=excludeFamilies.length?{...input.routing,excludeFamilies:[...(input.routing?.excludeFamilies??[]),...excludeFamilies]}:input.routing;
     const rev=await reviewFailover(store,id,trail,routing,next=>d.runReviewer(store,id,undefined,lenses,next,input.references,d.fetcher));
     const pending=routePending(rev);
     if(pending)return pending;
     trail.push({stage:'review',detail:{findings:(rev as {findings?:unknown[]}).findings?.length??0}});
     return undefined;
    };
    const first=await obtainReview();if(first)return finish({outcome:'route-pending',route:first});
    blocking=await openBlocking();
    if(blocking.length)await judge();
    let debt=reviewCoverageDebt(s,t);
    if(!blocking.length&&debt.length){
     const firstFamily=t.review?.family;
     const retry=await obtainReview(firstFamily?[firstFamily]:[]);
     if(retry)return finish({outcome:'route-pending',route:retry});
     blocking=await openBlocking();
     if(blocking.length)await judge();
     debt=reviewCoverageDebt(s,t);
    }
    if(!blocking.length&&!debt.length)return acceptChunk({reviewFamily:t.review?.family});
    if(!blocking.length)return finish({outcome:'escalated',stage:'review-evidence',reason:'Reviewer left obligations unreviewed; supply the requested host evidence or a corrected independent review',obligations:debt});
   }
   s=await store.load();t=taskOf(s,id);
   const course=(gate as Gate|undefined)?.course,sameDefect=(gate as Gate|undefined)?.sameDefect===true,reviewFamily=t.review?.family;
   const allowanceSpent=t.cycles-(t.ladderBase??0)>=s.config.flashRepairCycles+s.config.deepRepairCycles;
   const scopeOut=failing.includes(scopeCheckId)?await (async()=>{const r=t.receipts.find(r=>r.id===scopeCheckId)!;try{return (JSON.parse(await store.readArtifact(r.artifact)) as {stdout:string}).stdout;}catch{return undefined;}})():undefined;
   await repair(store,id,{sameDefect});
   if(taskOf(await store.load(),id).depth==='host')return finish({outcome:'escalated',stage:'repair-exhausted',depth:'host',reason:allowanceSpent?'Persistent repair allowance exhausted; host-depth diagnosis required':'The same defect survived a deep repair, so one more cheap repair would only repeat it; host-depth diagnosis required',findings:blocking,failingChecks:failing});
   try{out=await workerFailover(store,id,trail,t.workspace!,reviewFamily?{excludeFamilies:[reviewFamily]}:undefined,stalled,routing=>d.runWorker(store,id,{workspace:t.workspace!,brief:repairBrief(blocking,failing,course,scopeOut,input.brief),routing,skills:input.skills,references:input.references}));}
   catch(error){const escaped=escapedPaths(error);if(!escaped)throw error;trail.push({stage:'repair-worker',detail:{workspaceEscape:escaped}});return finish({outcome:'escalated',stage:'workspace-escape',escaped,reason:(error as Error).message});}
   pending=routePending(out);
   if(pending)return finish(pendingOutcome(pending));
   trail.push({stage:'repair-worker',detail:{cycle:taskOf(await store.load(),id).cycles}});
  }
 }catch(error){
  return finish({outcome:'failed',reason:(error as Error).message});
 }
}

type BatchOutcome = DelegateOutcome|{task:string;outcome:'failed';reason:string};
export type BatchInput={ids:string[];workspace?:string;briefs?:Record<string,string>;lenses?:string[];skills?:string[];references?:string[]};
export function validateBatch(input:BatchInput){
 const ids=input.ids;
 invariant(Array.isArray(ids)&&ids.length>0&&ids.every(id=>typeof id==='string'&&!!id.trim()),'delegate-batch needs an ids array of one or more task id strings; received '+JSON.stringify(input.ids));
 const repeated=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
 invariant(!repeated.length,'delegate-batch received duplicate task ids ('+repeated.join(', ')+'); delegate each task exactly once per batch');
 invariant(input.briefs===undefined||input.briefs!==null&&typeof input.briefs==='object'&&!Array.isArray(input.briefs)&&Object.values(input.briefs).every(b=>typeof b==='string'&&!!b.trim()),'delegate-batch briefs must map task ids to non-empty brief strings');
 const strays=Object.keys(input.briefs??{}).filter(id=>!ids.includes(id));
 invariant(!strays.length,`delegate-batch has briefs for ${strays.join(', ')}, which ${strays.length===1?'is':'are'} not in ids`);
}
export async function delegateBatch(store:Store,input:BatchInput,deps:Partial<DelegateDeps>={}){
 validateBatch(input);
 const ids=input.ids;
 const s=await store.load();
 const shared=new Map<string,string[]>();
 for(const id of ids){const workspace=input.workspace??taskOf(s,id).workspace;invariant(workspace,`Task ${id} has no workspace; prepare an isolated checkout per task before delegating a batch`);shared.set(workspace,[...shared.get(workspace)??[],id]);}
 const collided=[...shared.entries()].filter(([,members])=>members.length>1);
 invariant(!collided.length,collided.map(([workspace,members])=>`${members.join(' and ')} share workspace ${workspace}`).join('; ')+'. Batched tasks run concurrently and a shared workspace serializes them into conflicts; give each task its own checkout, and omit the batch workspace so each task uses its own.');
 const concurrency=Math.max(1,s.config.maxWorkers);
 const outcomes=new Array<BatchOutcome>(ids.length);
 const waiting=[...ids],running=new Set<string>();
 let wake=()=>{},changed=new Promise<void>(r=>{wake=r;});
 const finished=()=>{const done=wake;changed=new Promise<void>(r=>{wake=r;});done();};
 const refused=async(id:string,reason:string)=>{await store.transaction(s=>event(s,'delegate-finished',{id,outcome:'failed',reason})).catch(()=>{});return {task:id,outcome:'failed' as const,reason};};
 const run=async(id:string)=>{const index=ids.indexOf(id);try{outcomes[index]=await delegate(store,id,{workspace:input.workspace,brief:input.briefs?.[id],lenses:input.lenses,skills:input.skills,references:input.references},deps);}catch(error){outcomes[index]=await refused(id,(error as Error).message);}};
 const pump=async()=>{
  while(waiting.length){
   const turn=changed,state=await store.load();
   const at=waiting.findIndex(id=>![...running].some(other=>resourceSetsOverlap(taskOf(state,id).resources,taskOf(state,other).resources)));
   if(at<0){await turn;continue;}
   const [id]=waiting.splice(at,1);running.add(id);
   try{await run(id);}finally{running.delete(id);finished();}
  }
 };
 await Promise.all(Array.from({length:Math.min(concurrency,ids.length)},pump));
 return {delegated:ids.length,concurrency,outcomes};
}

const waitLimitMs=540000;
type WaitInput={after?:number;timeoutMs?:number};
function waitDeadline(input:WaitInput){
 const timeoutMs=input.timeoutMs??100000;
 invariant(Number.isInteger(timeoutMs)&&timeoutMs>=0&&timeoutMs<=waitLimitMs,`wait timeoutMs must be a whole number of milliseconds from 0 to ${waitLimitMs}`);
 invariant(input.after===undefined||Number.isInteger(input.after)&&input.after>=0,'wait after must be the cursor an earlier wait, delegate-batch or drive returned');
 return Date.now()+timeoutMs;
}
export async function waitForDrive(store:Store,input:WaitInput={},pollMs=2000){
 const deadline=waitDeadline(input);let after=input.after;
 for(;;){
  const s=await store.load();after??=s.events.length;
  const done=s.events.slice(after).findLast(e=>e.type==='drive-finished')?.detail as {outcome:string;report?:string}|undefined,open=openDrive(s);
  if(done||!open?.alive||Date.now()>=deadline)
   return {outcome:done?.report?'finished':done||open&&!open.alive?'interrupted':open?'still-running':'idle',cursor:s.events.length,drive:done?.report?JSON.parse(await store.readArtifact(done.report)):undefined,live:openDelegations(s).filter(d=>d.alive).map(d=>d.id),next:await next(store)};
  await new Promise(r=>setTimeout(r,Math.min(pollMs,Math.max(0,deadline-Date.now()))));
 }
}
export async function waitForDelegations(store:Store,input:WaitInput={},pollMs=2000){
 const deadline=waitDeadline(input);let after=input.after;
 for(;;){
  const s=await store.load();after??=s.events.length;
  const finished=s.events.slice(after).filter(e=>e.type==='delegate-finished').map(e=>{const d=e.detail as {id:string;outcome:string;reason?:string};return {id:d.id,outcome:d.outcome,reason:d.reason,at:e.at};});
  const open=openDelegations(s),live=open.filter(d=>d.alive).map(d=>d.id),interrupted=open.filter(d=>!d.alive).map(d=>d.id);
  if(finished.length||interrupted.length||!live.length||Date.now()>=deadline)
   return {outcome:finished.length?'finished':interrupted.length?'interrupted':live.length?'still-running':'idle',cursor:s.events.length,finished,live,interrupted,next:await next(store)};
  await new Promise(r=>setTimeout(r,Math.min(pollMs,Math.max(0,deadline-Date.now()))));
 }
}
