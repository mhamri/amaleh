import type { EffortState } from './effort.ts';
import { mkdir, readFile, writeFile, rename, readdir, rm, realpath } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { resourceSetsOverlap } from './resources.ts';

export type Command = { command:string; args:string[] };
export type IntegrationCheck = Command & { id:string };
export type Check = IntegrationCheck & { role:'probe'|'guard' };
export type Finding = { id:string; lens:string; location:string; scenario:string; evidence:string; consequence:string; blocking:boolean; disposition?:'open'|'resolved'|'refuted'; resolution?:string };
export type ReviewCoverage = { id:string; status:'covered'|'finding'|'unreviewed'|'not-applicable'; evidence:string };
export type Guidance = { skills?:string[]; references?:string[] };
export type Task = { id:string; title:string; goal:string; phase:string; deps:string[]; resources:string[]; criteria:string[]; checks:Check[]; kind:'code'|'research'|'plan'; skills?:string[]; references?:string[]; noProbe?:string; status:'ready'|'running'|'review'|'repair'|'accepted'|'blocked'; workspace?:string; activity?:{kind:'check'|'review';owner:{pid:number;coordinatorPid?:number;host:string;operation:string};checkId?:string}; owner?:{pid:number;coordinatorPid?:number;host:string;operation:string}; execution?:{kind:'routed-worker'|'coordinator-exception';authorization:string}; author?:string; family?:string; fingerprint?:string; output?:string; receipts:{id:string;code:number;fingerprint:string;artifact:string}[]; review?:{family:string;fingerprint:string;findings:Finding[];artifact:string;coverage?:ReviewCoverage[]}; cycles:number; depth:'flash'|'deep'|'host'; blocked?:string; integrated?:string };
export type Decision = { purpose?:'requirement'|'workflow'; id:string; question:string; criteria:Record<string,string>; state:unknown; revision:number; choice?:string; source?:string; confidence?:number; reason?:string; artifact?:string };
export type TaskInput = Pick<Task,'id'|'title'|'goal'|'phase'|'deps'|'resources'|'criteria'|'checks'|'kind'|'skills'|'references'> & { noProbe?:string };
export type ModelPool = { role:string; models:string[]; requiredInputs:string[]; requiresTools:boolean; notes:string };
export type Run = { schema:1; id:string; workspace:string; host:{kind:string;model:string}; effort?:EffortState; intent:string; criteria:string[]; constraints:string[]; decisions:Decision[]; tasks:Task[]; revision:number; status:'active'|'blocked'|'complete'; blocked?:string; config:{flashRepairCycles:number;deepRepairCycles:number;maxWorkers:number}; modelPools?:ModelPool[]; integrationChecks:IntegrationCheck[]; integrationReceipts:Task['receipts']; acceptance?:{fingerprint:string;claims:string[]}; lineage?:{continues:string;inheritedCriteria:string[];inheritedDecisions:string[]}; events:{at:string;type:string;detail:unknown}[] };
export type RunSummary = { id:string; status:Run['status']; intent:string; criteria:string[]; tasks:number; revision:number; continues?:string; acceptance?:Run['acceptance'] };
export type ShapeOption = { id:string; summary:string; gains:string; costs:string };
export type ShapeInput = { understanding:string; gaps?:string[]; pushback?:string[]; additions?:string[]; mentor?:string[]; options?:ShapeOption[]; recommendation?:string; clearCut?:string; questions?:string[]; affects?:string[]; chosen?:{option:string;quote:string} };
export type ShapeRequest = { request:number; kind:'intent'|'feedback'; text:string };
export type Shaped = { request:number; open:boolean; artifact:string; affects:string[]; questions:string[]; options:{id:string;summary:string}[]; recommendation?:string; chosen?:string };
export function invariant(value:unknown,message:string):asserts value { if(!value) throw new Error(message); }
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const idCheck=(id:string)=>invariant(typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id),'Invalid identifier');
export const scopeCheckId='scope';
export const taskCheckId=(id:string)=>{idCheck(id);invariant(id!==scopeCheckId,`Check id '${scopeCheckId}' is reserved for the built-in scope check; rename the registered check`);};
export function validCommand(c:Command) { invariant(c&&typeof c.command==='string'&&c.command.length>0&&Array.isArray(c.args)&&c.args.every(a=>typeof a==='string'),'Commands require an executable and argument array'); }
export function validRole(c:Check,taskId?:string) { invariant(c.role==='probe'||c.role==='guard',`Check ${c.id}${taskId?` on task ${taskId}`:''} requires role: 'probe' or 'guard'`); }
export function validateContract(t:TaskInput) {
 for(const c of t.checks){taskCheckId(c.id);validRole(c,t.id);}
 if(t.kind==='code')invariant(t.checks.some(c=>c.role==='probe')||typeof t.noProbe==='string'&&!!t.noProbe.trim(),`Code task ${t.id} needs at least one probe check or noProbe explaining why no executable can detect the defect`);
}
export function validateTasks(tasks:TaskInput[]) {
 const ids=new Set<string>(); for(const t of tasks){idCheck(t.id);invariant(!ids.has(t.id),'Duplicate task ID');ids.add(t.id);invariant(t.goal&&t.title&&Array.isArray(t.deps)&&Array.isArray(t.resources)&&Array.isArray(t.criteria)&&t.criteria.length&&Array.isArray(t.checks),'Task needs goal, title, dependencies, resources, criteria and checks');invariant(['code','research','plan'].includes(t.kind),'Invalid task kind'); for(const c of t.checks){idCheck(c.id);validCommand(c);} invariant(new Set(t.checks.map(c=>c.id)).size===t.checks.length,'Duplicate check ID');}
 const active=new Set<string>(),done=new Set<string>(); const visit=(id:string)=>{invariant(!active.has(id),'Dependency cycle');if(done.has(id))return;active.add(id);for(const dep of tasks.find(t=>t.id===id)!.deps){invariant(ids.has(dep),'Missing dependency');visit(dep);}active.delete(id);done.add(id);};for(const id of ids)visit(id);
}
export const taskOf=(s:Run,id:string)=>{const t=s.tasks.find(t=>t.id===id);invariant(t,'Unknown task');return t;};
export const unmetDependencies=(s:Run,t:Task)=>t.deps.filter(id=>taskOf(s,id).status!=='accepted'||!taskOf(s,id).integrated);
export function family(model:string):string { if(/deepseek/i.test(model))return 'deepseek';if(/glm|z-ai/i.test(model))return 'glm';if(/kimi|moonshot/i.test(model))return 'kimi';if(/claude|anthropic|fable/i.test(model))return 'claude';if(/astra|gpt|openai/i.test(model))return 'openai';return model.split('/')[0]; }
export function conflict(a:Task,b:Task){return !a.workspace||!b.workspace||a.workspace===b.workspace||resourceSetsOverlap(a.resources,b.resources);}
const ignored=new Set(['.git','.amaleh','node_modules','.DS_Store']);
export async function fingerprint(workspace:string):Promise<string>{
 const entries:string[]=[]; async function walk(dir:string){for(const ent of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(ignored.has(ent.name))continue;const path=join(dir,ent.name),name=relative(workspace,path).split(sep).join('/');if(ent.isSymbolicLink()){const {readlink}=await import('node:fs/promises');entries.push(`${name}:link:${await readlink(path)}`);}else if(ent.isDirectory())await walk(path);else if(ent.isFile())entries.push(`${name}:${hash((await readFile(path)).toString('base64'))}`);}}await walk(workspace);return hash(entries.join('\n'));
}
export class Store {
 root:string;amalehDir:string;
 constructor(workspace:string,runId:string){idCheck(runId);this.amalehDir=join(resolve(workspace),'.amaleh');this.root=join(this.amalehDir,'runs',runId);}
 async load():Promise<Run>{const names=(await readdir(this.root)).filter(n=>/^revision-\d{9}\.json$/.test(n)).sort();invariant(names.length,'Run not found');const state=JSON.parse(await readFile(join(this.root,names.at(-1)!), 'utf8'));invariant(state.schema===1,'Unsupported run schema');validateTasks(state.tasks);return state;}
 async artifact(data:unknown):Promise<string>{await mkdir(join(this.root,'artifacts'),{recursive:true});const text=typeof data==='string'?data:JSON.stringify(data,null,2),id=hash(text);await writeFile(join(this.root,'artifacts',id+'.json'),text,{flag:'wx'}).catch((e)=>{if(e.code!=='EEXIST')throw e;});return id;}
 async readArtifact(id:string){invariant(/^[a-f0-9]{64}$/.test(id),'Invalid artifact ID');return readFile(join(this.root,'artifacts',id+'.json'),'utf8');}
 async lock(){await mkdir(this.root,{recursive:true});const path=join(this.root,'lock');for(let attempt=0;;attempt++){try{await mkdir(path);break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(attempt>=100)throw new Error('Run is locked. Inspect owner; unlock only after verifying abandonment.');await new Promise(r=>setTimeout(r,50));}}try{await writeFile(join(path,'owner.json'),JSON.stringify({pid:process.pid,host:hostname()}));}catch(e){await rm(path,{recursive:true});throw e;}return ()=>rm(path,{recursive:true});}
 async unlock(){const path=join(this.root,'lock');const owner=JSON.parse(await readFile(join(path,'owner.json'),'utf8'));invariant(owner.host===hostname(),'Cannot verify remote owner');invariant(!processAlive(owner.pid),'Lock owner is alive');await rm(path,{recursive:true});}
 async transaction<T>(change:(s:Run)=>Promise<T>|T):Promise<T>{const release=await this.lock();try{const s=await this.load();invariant(s.status!=='complete',`Run ${s.id} is complete and cannot change. Start a new run with "continues":"${s.id}" to build on its criteria and settled decisions`);const result=await change(s);s.revision++;await this.save(s);return result;}finally{await release();}}
 async save(s:Run){const name=`revision-${String(s.revision).padStart(9,'0')}.json`,temp=join(this.root,randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(s,null,2));await rename(temp,join(this.root,name));}
}
export function event(s:Run,type:string,detail:unknown){s.events.push({at:new Date().toISOString(),type,detail});}
export function processAlive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
// A remote owner cannot be proven dead from here, so it counts as alive.
export function ownerAlive(owner:{pid:number;coordinatorPid?:number;host:string}){return owner.host!==hostname()||[owner.pid,owner.coordinatorPid].some(pid=>pid!==undefined&&processAlive(pid));}
export type OpenDelegation={id:string;pid?:number;host?:string;at:string;alive:boolean};
export function openDelegations(s:Run):OpenDelegation[]{
 const open=new Map<string,{pid?:number;host?:string;at:string}>();
 for(const e of s.events){const d=e.detail as {id:string;pid?:number;host?:string};if(e.type==='delegate-started')open.set(d.id,{pid:d.pid,host:d.host,at:e.at});else if(e.type==='delegate-finished')open.delete(d.id);}
 const legacyAlive=(id:string)=>{const t=s.tasks.find(t=>t.id===id),owner=t?.activity?.owner??t?.owner;return !!owner&&ownerAlive(owner);};
 return [...open].map(([id,d])=>({id,...d,alive:d.pid!==undefined&&d.host?ownerAlive({pid:d.pid,host:d.host}):legacyAlive(id)}));
}
export function reopenReasons(s:Run,id:string):string[]{
 let reasons:string[]=[];
 for(const e of s.events){const d=e.detail as {id?:string;reason?:string};if(d?.id!==id)continue;if(e.type==='accepted')reasons=[];else if(e.type==='invalidated'&&d.reason)reasons.push(d.reason);}
 return reasons;
}
// See references/planning.md#shape-every-request
export function shaping(s:Run){
 const requests=s.events.filter(e=>e.type==='request');
 if(!requests.length)return undefined;
 const request=requests.at(-1)!.detail as ShapeRequest;
 const shape=s.events.filter(e=>e.type==='shaped'&&(e.detail as Shaped).request===request.request).map(e=>e.detail as Shaped).at(-1);
 return {request,shape,due:!shape,open:!!shape?.open};
}
export function requireShaped(s:Run,operation:string){
 const state=shaping(s);
 if(!state)return;
 invariant(!state.due,`${operation} waits for the ${state.request.kind} "${state.request.text.slice(0,160)}" to be shaped: run shape first, with your understanding, what is missing, pushback, additions and the options you see`);
 invariant(!state.open,`${operation} waits for the user: the shape of request ${state.request.request} still has open questions or an unchosen option. Put them to the user, then run shape again with the answers or chosen`);
}
const strings=(value:unknown,field:string)=>{invariant(value===undefined||Array.isArray(value)&&value.every(v=>typeof v==='string'&&!!v.trim()),`shape ${field} must be an array of non-empty strings`);return (value as string[]|undefined)??[];};
export function validateShape(s:Run,input:ShapeInput){
 invariant(input&&typeof input.understanding==='string'&&!!input.understanding.trim(),'shape needs understanding: the request restated in your own words, including what it is for');
 const options=input.options??[];
 invariant(Array.isArray(options)&&options.every(o=>o&&[o.id,o.summary,o.gains,o.costs].every(v=>typeof v==='string'&&!!v.trim())),'Each shape option needs id, summary, gains and costs');
 invariant(new Set(options.map(o=>o.id)).size===options.length,'Shape option ids must be unique');
 const clearCut=typeof input.clearCut==='string'?input.clearCut.trim():'';
 invariant(!(clearCut&&options.length),'Pass clearCut or options, not both');
 invariant(clearCut||options.length>=2&&options.length<=4,'shape needs two to four options that genuinely differ, or clearCut naming why the request has only one sensible reading');
 invariant(!options.length||options.some(o=>o.id===input.recommendation),'recommendation must name one of the option ids');
 const affects=strings(input.affects,'affects');for(const id of affects)taskOf(s,id);
 const chosen=input.chosen;
 invariant(chosen===undefined||options.some(o=>o.id===chosen?.option)&&typeof chosen.quote==='string'&&!!chosen.quote.trim(),'chosen needs an option id from options and quote with the user\'s actual words');
 return {understanding:input.understanding.trim(),gaps:strings(input.gaps,'gaps'),pushback:strings(input.pushback,'pushback'),additions:strings(input.additions,'additions'),mentor:strings(input.mentor,'mentor'),options,recommendation:input.recommendation,clearCut:clearCut||undefined,questions:strings(input.questions,'questions'),affects,chosen};
}
export function recordShape(s:Run,shape:ReturnType<typeof validateShape>,artifact:string){
 const state=shaping(s);invariant(state,'Nothing to shape: this run predates shaping and has no recorded request; record new user feedback with feedback');
 const open=shape.questions.length>0||shape.options.length>0&&!shape.chosen;
 const detail:Shaped={request:state.request.request,open,artifact,affects:shape.affects,questions:shape.questions,options:shape.options.map(o=>({id:o.id,summary:o.summary})),recommendation:shape.recommendation,chosen:shape.chosen?.option};
 event(s,'shaped',detail);
 if(shape.chosen){
  const option=shape.options.find(o=>o.id===shape.chosen!.option)!;
  s.decisions.push({purpose:'requirement',id:`shape-${state.request.request}-${randomUUID().slice(0,8)}`,question:`How should this ${state.request.kind} be delivered: ${state.request.text.slice(0,200)}`,criteria:{[option.id]:option.summary},choice:option.id,source:'user',reason:shape.chosen.quote,state:{understanding:shape.understanding,additions:shape.additions},revision:s.revision});
 }
 return detail;
}
export async function shape(store:Store,input:ShapeInput){
 const s=await store.load(),validated=validateShape(s,input),artifact=await store.artifact(validated);
 return store.transaction(current=>recordShape(current,validateShape(current,input),artifact));
}
export async function feedback(store:Store,input:{text:string}){
 invariant(input&&typeof input.text==='string'&&!!input.text.trim(),'feedback needs text quoting what the user actually said');
 return store.transaction(s=>{const request:ShapeRequest={request:s.events.filter(e=>e.type==='request').length+1,kind:'feedback',text:input.text.trim()};event(s,'request',request);return request;});
}
// See references/planning.md#shape-every-request
function feedbackReopen(s:Run,id:string){
 const state=shaping(s);
 invariant(state?.request.kind==='feedback'&&state.shape&&!state.open,'feedback reopen needs the latest request to be user feedback whose shape is settled');
 invariant(state.shape.affects.includes(id),`Shaped feedback ${state.request.request} does not name ${id} in affects; reshape it to include this task`);
 invariant(!s.events.some(e=>e.type==='invalidated'&&(e.detail as {id?:string;feedback?:number}).id===id&&(e.detail as {feedback?:number}).feedback===state.request.request),`${id} was already reopened for feedback ${state.request.request}`);
 return state.request.request;
}
const intentStopwords=new Set(['with','that','this','from','into','when','then','they','them','have','will','make','must','also','only','does','each','over','than','such','been','were','what','which','their','there','using','still']);
const intentWords=(text:string)=>new Set(text.toLowerCase().split(/[^a-z]+/).filter(w=>w.length>=4&&!intentStopwords.has(w)));
function intentOverlap(a:Set<string>,b:Set<string>){const smaller=Math.min(a.size,b.size);if(!smaller)return 0;let shared=0;for(const word of a)if(b.has(word))shared++;return shared/smaller;}
async function priorRuns(workspace:string,exclude:string):Promise<{id:string;intent:string;criteria:string[]}[]>{
 let names:string[];try{names=await readdir(join(workspace,'.amaleh','runs'));}catch{return [];}
 const runs:{id:string;intent:string;criteria:string[]}[]=[];
 for(const name of names){if(name===exclude)continue;try{
  const dir=join(workspace,'.amaleh','runs',name),revisions=(await readdir(dir)).filter(n=>/^revision-\d{9}\.json$/.test(n)).sort();if(!revisions.length)continue;
  const prior=JSON.parse(await readFile(join(dir,revisions.at(-1)!),'utf8'));
  if(typeof prior?.intent==='string'&&Array.isArray(prior?.criteria))runs.push({id:name,intent:prior.intent,criteria:prior.criteria.filter((c:unknown)=>typeof c==='string')});
 }catch{continue;}}
 return runs;
}
async function overlappingRun(workspace:string,id:string,intent:string){
 const words=intentWords(intent);let closest:{id:string;intent:string;score:number}|undefined;
 for(const prior of await priorRuns(workspace,id)){const score=intentOverlap(words,intentWords([prior.intent,...prior.criteria].join(' ')));if(score>=0.3&&(!closest||score>closest.score))closest={id:prior.id,intent:prior.intent,score};}
 return closest;
}
async function continuedRun(workspace:string,continues:string):Promise<Run>{
 return new Store(workspace,continues).load().catch((error:Error)=>{throw new Error(`Cannot continue run ${continues}: ${error.message}; name a prior run of this workspace or drop continues`);});
}
export async function start(workspace:string,input:{id:string;host:Run['host'];intent:string;criteria:string[];constraints?:string[];continues?:string;unrelated?:string;shape?:ShapeInput}):Promise<Store>{
 invariant(input.intent&&input.criteria?.length&&input.host?.kind&&input.host?.model,'Intent, acceptance criteria and actual host identity required');
 const root=await realpath(workspace),unrelated=input.unrelated?.trim();
 const prior=input.continues?await continuedRun(root,input.continues):undefined;
 const overlapping=input.continues?undefined:await overlappingRun(root,input.id,input.intent);
 if(overlapping)invariant(unrelated,`Run ${overlapping.id} already covers "${overlapping.intent}" at ${overlapping.score.toFixed(2)} word overlap; pass continues with ${overlapping.id} to build on its decisions, or unrelated with a reason`);
 const store=new Store(root,input.id),release=await store.lock();
 try{invariant(!(await readdir(store.root)).some(n=>n.startsWith('revision-')),'Run already exists: resume it');
 const inherited=(prior?.decisions??[]).filter(d=>d.purpose==='requirement'&&d.choice).map(d=>({purpose:'requirement' as const,id:d.id,question:d.question,criteria:d.criteria,state:d.state,choice:d.choice,reason:d.reason,revision:d.revision,source:`inherited:${input.continues}`}));
 const s:Run={schema:1,id:input.id,workspace:root,host:input.host,intent:input.intent,criteria:input.criteria,constraints:input.constraints??[],decisions:inherited,tasks:[],revision:0,status:'active',config:{flashRepairCycles:2,deepRepairCycles:1,maxWorkers:3},integrationChecks:[],integrationReceipts:[],events:[]};
 event(s,'started',{host:input.host});
 if(prior&&input.continues){s.lineage={continues:input.continues,inheritedCriteria:prior.criteria,inheritedDecisions:inherited.map(d=>d.id)};event(s,'continues',{continues:input.continues,inheritedCriteria:prior.criteria.length,inheritedDecisions:inherited.length});}
 if(unrelated&&!input.continues)event(s,'unrelated-run',{reason:unrelated,matched:overlapping?.id,score:overlapping?.score});
 event(s,'request',{request:1,kind:'intent',text:input.intent} satisfies ShapeRequest);
 if(input.shape!==undefined){const shaped=validateShape(s,input.shape);recordShape(s,shaped,await store.artifact(shaped));}
 await store.save(s);return store;}finally{await release();}}
export async function plan(store:Store,input:{tasks:TaskInput[];integrationChecks:IntegrationCheck[];singleChunk?:string}){await store.transaction(s=>{requireShaped(s,'plan');invariant(Array.isArray(input.tasks)&&Array.isArray(input.integrationChecks),'Tasks and integrationChecks required');const existing=new Map(s.tasks.map(t=>[t.id,t]));const tasks=input.tasks.map(t=>{const old=existing.get(t.id);if(old){invariant(JSON.stringify([old.goal,old.deps,old.criteria,old.checks])===JSON.stringify([t.goal,t.deps,t.criteria,t.checks]),'Existing task contract changed; invalidate/replan explicitly');return old;}return {...t,status:'ready' as const,cycles:0,depth:'flash' as const,receipts:[]};});invariant([...existing.keys()].every(id=>tasks.some(t=>t.id===id)),'Cannot drop task history');validateTasks(tasks);for(const t of input.tasks)if(!existing.has(t.id))validateContract(t);const singleChunk=input.singleChunk?.trim();if(tasks.length===1&&!existing.has(tasks[0].id)&&(s.criteria.length>=3||tasks[0].criteria.length>=4)){invariant(singleChunk,`Single task for ${s.criteria.length} run outcomes and ${tasks[0].criteria.length} task criteria; split into independent chunks or pass singleChunk with a reason`);event(s,'single-chunk',{reason:singleChunk,runCriteria:s.criteria.length,taskCriteria:tasks[0].criteria.length});}input.integrationChecks.forEach(validCommand);s.tasks=tasks;s.integrationChecks=input.integrationChecks;s.integrationReceipts=[];event(s,'planned',{tasks:tasks.map(t=>t.id)});});}
// Coverage is an explicit reviewer attestation, not proof that all defects were found.
export function reviewObligations(s:Run,t:Task):{id:string;question:string}[]{return [
 ...t.criteria.map((criterion,i)=>({id:`criterion:${i+1}`,question:`Spec: inspect the actual behavior satisfying task criterion: ${criterion}`})),
 ...s.criteria.map((criterion,i)=>({id:`outcome:${i+1}`,question:`Spec: trace what THIS task contributes to, or preserves of, run outcome: ${criterion}. Judge only this task's own changes; whether other tasks have delivered their share is not yours to assess. Mark this not-applicable, naming the component that owns it, only when no change in this workspace could affect the outcome either way.`})),
 {id:'standards',question:'Standards: inspect applicable repository instructions and conventions; distinguish real violations from preferences.'},
 {id:'boundaries',question:'Trace changed inputs, outputs and affected callers; inspect malformed, empty and rejected inputs, and contract compatibility.'},
 {id:'lifecycle',question:'Trace reachable success, failure, interruption and recovery exits; verify durable evidence, cleanup and terminal ordering.'},
 {id:'parallelism',question:'For actual overlap, retry or shared-state paths, inspect ownership, capacity, conflicts and the complete eligible work frontier.'},
 {id:'integration',question:'Trace affected consumers and integrated outcomes; check deterministic rejection before external effects and verify evidence against the actual artifacts.'},
 ...reopenReasons(s,t.id).map((reason,i)=>({id:`reopened:${i+1}`,question:`Verify against the actual artifact that the defect which reopened this task is gone: ${reason}`}))
];}
const ownObligation=/^(criterion|reopened):/;
function validateReviewCoverage(s:Run,t:Task,coverage:ReviewCoverage[],findings:Finding[]=[]){
 const required=reviewObligations(s,t);invariant(Array.isArray(coverage),'Review coverage must be an array');
 const claimed=coverage.filter(c=>c?.status==='finding').map(c=>c.id);
 invariant(!claimed.length||findings.length,`Coverage marks ${claimed.join(', ')} as finding while the findings array is empty; use covered when inspection found no defect, or file the defect as a finding`);
 invariant(coverage.length===required.length&&new Set(coverage.map(c=>c?.id)).size===required.length&&coverage.every(c=>c&&required.some(r=>r.id===c.id)),'Review coverage must include every obligation exactly once; missing, duplicate or unknown IDs');
 for(const c of coverage){invariant(['covered','finding','unreviewed','not-applicable'].includes(c.status)&&typeof c.evidence==='string'&&!!c.evidence.trim(),'Review coverage requires a valid status and nonempty evidence');invariant(c.status!=='not-applicable'||!ownObligation.test(c.id),'This task\'s own criteria and reopen reasons cannot be not-applicable; they are what it was asked to deliver');}
}
export function reviewCoverageDebt(s:Run,t:Task){return reviewObligations(s,t).filter(required=>{
 const matches=t.review?.coverage?.filter(c=>c.id===required.id)??[];
 return matches.length!==1||!matches[0].evidence?.trim()||!(matches[0].status==='covered'||matches[0].status==='not-applicable'&&!ownObligation.test(required.id));
});}
export const hostAuthored=(t:Task)=>t.execution?.kind==='coordinator-exception';
export const openBlocking=(t:Task)=>!!t.review?.findings.some(f=>f.blocking&&f.disposition==='open');
const scopeEvents=(s:Run,id:string)=>s.events.filter(e=>(e.type==='scope-question'||e.type==='scope-answered')&&(e.detail as {id?:string}).id===id);
export const askedScopePaths=(s:Run,id:string)=>new Set(scopeEvents(s,id).filter(e=>e.type==='scope-question').flatMap(e=>(e.detail as {outOfScope:string[]}).outOfScope));
export function scopeQuestion(s:Run,t:Task){
 if(!t.receipts.some(r=>r.id===scopeCheckId&&r.code!==0))return undefined;
 const last=scopeEvents(s,t.id).at(-1);
 return last?.type==='scope-question'?last.detail as {fingerprint:string;outOfScope:string[]}:undefined;
}
export function answerScopeQuestion(s:Run,t:Task,answer:'revert'|'amend'){if(scopeQuestion(s,t))event(s,'scope-answered',{id:t.id,answer});}
export type ContractQuestion={question:string;check?:string};
export function contractQuestions(s:Run,t:Task):ContractQuestion[]{
 const events=s.events.filter(e=>(e.type==='contract-question'||e.type==='contract-answered')&&(e.detail as {id?:string}).id===t.id);
 const answered=events.findLastIndex(e=>e.type==='contract-answered');
 return events.slice(answered+1).map(e=>{const d=e.detail as ContractQuestion;return {question:d.question,check:d.check};});
}
export function answerContractQuestions(s:Run,t:Task,answer:'stands'|'amend',reason:string){if(contractQuestions(s,t).length)event(s,'contract-answered',{id:t.id,answer,reason});}
export function keptForUpstream(s:Run,t:Task){
 for(let i=s.events.length-1;i>=0;i--){const e=s.events[i],d=e.detail as {id?:string;reverified?:string[]};
  if((e.type==='accepted'||e.type==='result')&&d.id===t.id)return false;
  if(e.type==='invalidated'&&d.reverified?.includes(t.id))return true;}
 return false;
}
const gitOutput=async(cwd:string,args:string[])=>{try{const r=await execute({command:'git',args},cwd);return r.code===0?r.stdout.trim():undefined;}catch{return undefined;}};
export async function runCommitMissingFromCheckout(s:Run,t:Task){
 const runHead=await gitOutput(s.workspace,['rev-parse','HEAD']);
 if(!runHead||!t.workspace||!await gitOutput(t.workspace,['rev-parse','HEAD']))return undefined;
 try{return (await execute({command:'git',args:['merge-base','--is-ancestor',runHead,'HEAD']},t.workspace)).code===1?runHead:undefined;}catch{return undefined;}
}
export const refreshCheckoutReason=(t:Task,runHead:string)=>`Task ${t.id} kept its output when a task it depends on was reopened, but its checkout ${t.workspace} does not contain the run's integrated commit ${runHead}. Merge the run branch into that checkout, then delegate it again so its checks and review judge it on top of the new upstream`;
export async function raiseContractQuestion(store:Store,input:{taskId:string;question:string;check?:string}){
 const question=typeof input.question==='string'?input.question.trim():'';
 invariant(question&&question.length<=4000,'A contract question needs the problem and its evidence, at most 4000 characters');
 await store.transaction(s=>{const t=taskOf(s,input.taskId);
  invariant(t.status==='running','A contract question is raised by the worker while it runs this task');
  invariant(input.check===undefined||t.checks.some(c=>c.id===input.check),`Task ${t.id} has no check named ${input.check}; name a registered check or omit it`);
  event(s,'contract-question',{id:t.id,question,check:input.check});
 });
}
async function reviewAction(s:Run,t:Task){if(t.activity)return {action:'await-verification',task:t.id,activity:t.activity}; const unmet=unmetDependencies(s,t);if(unmet.length)return {action:'reconcile-dependencies',task:t.id,dependencies:unmet}; let fp:string; try{fp=await fingerprint(t.workspace!);}catch(error){if(!workspaceUnavailable(error))throw error;return {action:'reconcile-workspace',task:t.id,workspace:t.workspace,reason:(error as Error).message,recovery:'Restore workspace access, or resume to block affected work while independent tasks continue'};} const questions=contractQuestions(s,t); if(questions.length)return {action:'contract-question',task:t.id,questions,answers:'amend the task contract, or delegate again with a brief that answers the question so the checks and review judge the output as it stands'}; if(keptForUpstream(s,t)){const runCommit=await runCommitMissingFromCheckout(s,t);if(runCommit)return {action:'refresh-checkout',task:t.id,workspace:t.workspace,reason:refreshCheckoutReason(t,runCommit)};} const missing=t.checks.filter(c=>!t.receipts.some(r=>r.id===c.id&&r.fingerprint===fp&&r.code===0)); if(t.receipts.some(r=>r.code!==0)){const question=scopeQuestion(s,t);return question?{action:'scope-question',task:t.id,outOfScope:question.outOfScope,answers:'amend resources to keep these paths, or delegate again so a repair reverts them'}:{action:'repair-needed',task:t.id};} if(missing.length)return {action:'check',task:t.id,checks:missing}; if(hostAuthored(t))return {action:'accept',task:t.id,hostFinal:true}; if(!t.review||t.review.fingerprint!==fp)return {action:'review',tasks:[{id:t.id,author:t.family,workspace:t.workspace}]}; if(t.review.findings.some(f=>f.blocking&&f.disposition==='open'))return {action:'triage-repair',task:t.id,findings:t.review.findings}; const coverage=reviewCoverageDebt(s,t); if(coverage.length)return {action:'review-evidence-needed',task:t.id,obligations:coverage.map(o=>({...o,evidence:t.review?.coverage?.find(c=>c.id===o.id)?.evidence})),reviewArtifact:t.review.artifact}; return {action:'accept',task:t.id};}
async function nextAction(s:Run,reviewActions:Map<string,Awaited<ReturnType<typeof reviewAction>>>){if(s.status==='complete')return {action:'done',run:s.id,acceptance:s.acceptance};if(s.status==='blocked')return {action:'intervention',reason:s.blocked};const untracked=s.tasks.filter(t=>t.status==='running'&&!t.execution);if(untracked.length)return {action:'reconcile-execution',tasks:untracked.map(t=>t.id),reason:'Legacy running claims lack execution authorization; reconcile live ownership and preserve artifacts before requeueing through worker routing'};const orphaned=activeTasks(s).filter(t=>{const owner=t.activity?.owner??t.owner;return !!owner&&!ownerAlive(owner);});if(orphaned.length)return {action:'resume',tasks:orphaned.map(t=>t.id),reason:'The recorded owner of this work is no longer running; resume to reconcile it before trusting its status'};if(s.effort?.request)return {action:s.effort.request.status==='running'?'await-host-effort':'execute-host-effort',model:s.effort.model,base:s.effort.base,modes:s.effort.modes,...s.effort.request};const shapingNow=shaping(s);if(shapingNow?.due)return {action:'shape',request:shapingNow.request,guide:'references/planning.md#shape-every-request'};if(shapingNow?.open)return {action:'ask-user',request:shapingNow.request,questions:shapingNow.shape!.questions,options:shapingNow.shape!.options,recommendation:shapingNow.shape!.recommendation,shapeArtifact:shapingNow.shape!.artifact};const pending=s.decisions.find(d=>!d.choice);if(pending)return {action:'host-decision',decision:pending};if(!s.tasks.length)return {action:'discover-specify-plan',intent:s.intent,criteria:s.criteria};const review=s.tasks.filter(t=>t.status==='review'),verifiable=review.filter(t=>reviewActions.get(t.id)!.action!=='reconcile-dependencies');if(verifiable.length)return reviewActions.get(verifiable[0].id)!;const repair=s.tasks.filter(t=>t.status==='repair');if(repair.length)return {action:'repair',tasks:repair.map(t=>({id:t.id,depth:t.depth,cycles:t.cycles,findings:t.review?.findings.filter(f=>f.blocking&&f.disposition!=='resolved'&&f.disposition!=='refuted')}))};const running=s.tasks.filter(t=>t.status==='running');const ready=s.tasks.filter(t=>t.status==='ready'&&!unmetDependencies(s,t).length);if(ready.length&&running.length<s.config.maxWorkers)return {action:'route-dispatch',tasks:ready.map(t=>({id:t.id,goal:t.goal,criteria:t.criteria})),available:Math.max(0,s.config.maxWorkers-running.length)};const integrate=s.tasks.filter(t=>t.status==='accepted'&&!t.integrated);if(integrate.length)return {action:'integrate',tasks:integrate.map(t=>t.id)};if(running.length)return {action:'await-workers',tasks:running.map(t=>({id:t.id,owner:t.owner}))};const blocked=s.tasks.filter(t=>t.status==='blocked');if(blocked.length)return {action:'resolve-blockers',tasks:blocked.map(t=>({id:t.id,reason:t.blocked}))};if(review.length)return reviewActions.get(review[0].id)!;return {action:'verify-feature',criteria:s.criteria,checks:s.integrationChecks};}
export const activeTasks=(s:Run)=>s.tasks.filter(t=>t.status==='running'||!!t.activity);
export async function acquireActivity(store:Store,id:string,kind:'check'|'review',checkId?:string,beforeStart?:(s:Run)=>void|Promise<void>){return store.transaction(async s=>{const t=taskOf(s,id);invariant(t.status==='review'&&t.workspace,'Task not awaiting verification');invariant(!t.activity,'Task verification already active');const live=activeTasks(s);invariant(live.length<s.config.maxWorkers,'Worker capacity reached');invariant(!live.some(other=>conflict(t,other)),'Conflicting live task');await beforeStart?.(s);const operation=randomUUID();t.activity={kind,checkId,owner:{pid:process.pid,coordinatorPid:process.pid,host:hostname(),operation}};event(s,'activity-started',{id,...t.activity});return operation;});}
export async function activitySpawned(store:Store,id:string,operation:string,pid:number){await store.transaction(s=>{const activity=taskOf(s,id).activity;invariant(activity?.owner.operation===operation,'Verification ownership changed');activity.owner.pid=pid;});}
export async function releaseActivity(store:Store,id:string,operation:string){await store.transaction(s=>{const t=taskOf(s,id);if(t.activity?.owner.operation===operation){t.activity=undefined;event(s,'activity-finished',{id,operation});}});}
export async function configure(store:Store,input:Partial<Run['config']>&{userInstruction?:string}){await store.transaction(s=>{
 const keys=(['maxWorkers','flashRepairCycles','deepRepairCycles'] as const).filter(key=>input[key]!==undefined);
 for(const key of keys)invariant(Number.isInteger(input[key])&&input[key]!>0,`Invalid ${key}`);
 const budget=keys.filter(key=>key!=='maxWorkers'&&input[key]!==s.config[key]);
 const userInstruction=typeof input.userInstruction==='string'?input.userInstruction.trim():'';
 invariant(!budget.length||userInstruction,`The repair budget is the user's policy: changing ${budget.join(' and ')} needs userInstruction quoting the user's explicit request. An escalation is a diagnosis to make, not a reason to buy more cycles`);
 for(const key of keys)s.config[key]=input[key]!;
 event(s,'configured',budget.length?{...s.config,userInstruction}:s.config);
});}
export function hostExceptionKey(s:Run,t:Task){return hash(JSON.stringify({host:s.host,intent:s.intent,constraints:s.constraints,repairPolicy:{flash:s.config.flashRepairCycles,deep:s.config.deepRepairCycles},task:{id:t.id,goal:t.goal,criteria:t.criteria,checks:t.checks,deps:t.deps,resources:t.resources,kind:t.kind,status:t.status,cycles:t.cycles,depth:t.depth,output:t.output}}));}
export async function hostException(store:Store,input:{id:string;reason:'user-request'|'repair-escalation';evidence:string}){
 const authorization=randomUUID();await store.transaction(s=>{const t=taskOf(s,input.id);
 invariant(['ready','repair'].includes(t.status),'Exception requires an executable task');
 invariant(['user-request','repair-escalation'].includes(input.reason)&&typeof input.evidence==='string'&&!!input.evidence.trim(),'Explicit user request or exhausted repair escalation evidence required');
 if(input.reason==='repair-escalation')invariant(t.depth==='host'&&t.cycles>s.config.flashRepairCycles+s.config.deepRepairCycles,'Repair escalation not exhausted');
 event(s,'host-exception-granted',{authorization,id:t.id,key:hostExceptionKey(s,t),model:s.host.model,reason:input.reason,evidence:input.evidence});
 });return {authorization};
}
export async function claim(store:Store,id:string,input:{workspace:string;model:string;pid?:number;routeDecisionId?:string;hostAuthorization?:string}){
 await store.transaction(async s=>{const t=taskOf(s,id);
 invariant(['ready','repair'].includes(t.status)&&!t.activity,'Task is not executable');
 invariant(!unmetDependencies(s,t).length,'Unmet dependencies');
 invariant(input.model,'Actual author model required');
 const workspace=await realpath(input.workspace),live=activeTasks(s).filter(other=>other.id!==id);
 invariant(live.length<s.config.maxWorkers,'Worker capacity reached');
 invariant(!live.some(other=>conflict({...t,workspace},other)),'Conflicting live task');
 invariant(!(input.routeDecisionId&&input.hostAuthorization),'Choose one execution authorization');
 if(input.hostAuthorization){
  const grant=s.events.find(e=>e.type==='host-exception-granted'&&(e.detail as any).authorization===input.hostAuthorization)?.detail as any;
  invariant(grant&&grant.id===id&&grant.key===hostExceptionKey(s,t)&&grant.model===s.host.model&&input.model===s.host.model,'Host exception is missing, stale or for another task/model');
  invariant(!s.events.some(e=>e.type==='host-exception-used'&&(e.detail as any).authorization===input.hostAuthorization),'Host exception already consumed');
  event(s,'host-exception-used',{authorization:input.hostAuthorization,id,model:input.model});
  t.execution={kind:'coordinator-exception',authorization:input.hostAuthorization};
 }else{
  if(t.depth==='deep')invariant(family(input.model)==='kimi','Kimi diagnosis required before another Flash repair');
  invariant(t.depth!=='host','Main model must take over with a recorded repair-escalation exception');
  invariant(input.routeDecisionId,'Routed worker execution required; coordinator implementation needs an explicit host exception');
  const {consumeWorkerRoute}=await import('./routing.ts');consumeWorkerRoute(s,id,input.model,workspace,input.routeDecisionId);
  t.execution={kind:'routed-worker',authorization:input.routeDecisionId};
 }
 t.workspace=workspace;t.author=input.model;t.family=family(input.model);t.status='running';t.owner={pid:input.pid??process.pid,coordinatorPid:process.pid,host:hostname(),operation:randomUUID()};t.receipts=[];t.integrated=undefined;s.integrationReceipts=[];
 event(s,'claimed',{id,workspace,model:input.model,execution:t.execution,operation:t.owner.operation});
 });
}
export async function reconcileExecution(store:Store,input:{id:string;operation?:string;confirmedStopped:boolean;evidence:string}){
 await store.transaction(s=>{const t=taskOf(s,input.id);
 invariant(t.status==='running'&&!t.execution&&!t.activity,'Only legacy running execution may be reconciled');
 invariant(input.confirmedStopped===true&&typeof input.evidence==='string'&&!!input.evidence.trim(),'Inspect and confirm stopped execution with evidence');
 invariant(input.operation===t.owner?.operation,'Execution ownership changed; inspect current owner');
 event(s,'legacy-execution-reconciled',{id:t.id,prior:structuredClone(t),evidence:input.evidence});
 t.owner=undefined;t.status='blocked';t.blocked='Legacy execution stopped; inspect preserved artifacts and requeue through routing';
 });
}
export async function result(store:Store,id:string,output:unknown){const artifact=await store.artifact(output);await store.transaction(async s=>{const t=taskOf(s,id);invariant(t.status==='running'&&t.workspace,'Task not running');invariant(t.execution,'Legacy claim lacks execution authorization; reconcile and requeue through worker routing');t.fingerprint=await fingerprint(t.workspace);t.output=artifact;t.review=undefined;t.status='review';t.owner=undefined;event(s,'result',{id,artifact,fingerprint:t.fingerprint});});}
export async function execute(command:Command,cwd:string,onSpawn?:(pid:number)=>Promise<void>):Promise<{code:number;stdout:string;stderr:string}>{validCommand(command);return new Promise((done,fail)=>{const child=spawn(command.command,command.args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);let ownershipError:unknown;const ownership=Promise.resolve().then(()=>child.pid?onSpawn?.(child.pid):undefined).catch(error=>{ownershipError=error;child.kill();});child.on('error',fail);child.on('close',code=>{void ownership.then(()=>{if(ownershipError)fail(ownershipError);else done({code:code??1,stdout,stderr});});});});}
export async function check(store:Store,id:string|undefined,checkId:string){const s=await store.load(),t=id?taskOf(s,id):undefined;const c=(t?t.checks:s.integrationChecks).find(c=>c.id===checkId);invariant(c,'Unknown check');const cwd=t?.workspace??s.workspace;const operation=id?await acquireActivity(store,id,'check',checkId):undefined;try{const before=await fingerprint(cwd);let receipt:{code:number;stdout:string;stderr:string};try{receipt=await execute(c,cwd,id&&operation?pid=>activitySpawned(store,id,operation,pid):undefined);}catch(error){receipt={code:1,stdout:"",stderr:"Check could not execute: "+(error as Error).message};}const after=await fingerprint(cwd);const artifact=await store.artifact({command:c,cwd,before,after,...receipt});await store.transaction(current=>{const target=id?taskOf(current,id):undefined;invariant(!target||target.workspace===cwd,'Task workspace changed during check');const list=target?target.receipts:current.integrationReceipts;const prior=list.findIndex(r=>r.id===checkId);if(prior>=0)list.splice(prior,1);list.push({id:checkId,code:receipt.code,fingerprint:before,artifact});event(current,'check',{id,checkId,code:receipt.code,artifact});});return {code:receipt.code,artifact,changed:before!==after};}finally{if(id&&operation)await releaseActivity(store,id,operation);}}
export async function addReviewCheck(store:Store,id:string,check:Check){await store.transaction(s=>{
 const t=taskOf(s,id);invariant(t.status==='review'&&!t.activity,'Review evidence checks require an idle task awaiting review');
 taskCheckId(check.id);validCommand(check);validRole(check,t.id);invariant(!t.checks.some(c=>c.id===check.id),'Duplicate check ID');
 t.checks.push(check);t.review=undefined;event(s,'review-check-added',{id,check});
});}
export async function review(store:Store,id:string,input:{model:string;findings:Finding[];fingerprint:string;report:string;coverage?:ReviewCoverage[]}){const artifact=await store.artifact(input);await store.transaction(async s=>{const t=taskOf(s,id);invariant(t.status==='review'&&t.workspace,'Task not awaiting review');invariant(input.model&&family(input.model)!==t.family,'Review requires another model family');invariant(input.fingerprint===await fingerprint(t.workspace),'Review evidence is stale');invariant(Array.isArray(input.findings)&&typeof input.report==='string'&&input.report.length>0,'Review report required');for(const f of input.findings)invariant(f.id&&f.lens&&f.location&&f.scenario&&f.evidence&&f.consequence&&typeof f.blocking==='boolean','Finding lacks evidence');if(input.coverage!==undefined)validateReviewCoverage(s,t,input.coverage,input.findings);const findings=input.findings.map(f=>({...f,disposition:'open' as const}));t.review={family:family(input.model),fingerprint:input.fingerprint,findings,artifact,coverage:input.coverage};event(s,'review',{id,artifact});});}
function chargeCycle(s:Run,t:Task){t.cycles++;t.depth=t.cycles>s.config.flashRepairCycles+s.config.deepRepairCycles?'host':t.cycles>s.config.flashRepairCycles?'deep':'flash';}
export async function repair(store:Store,id:string){await store.transaction(s=>{const t=taskOf(s,id);invariant(t.status==='review'&&!t.activity,'Task is not in review or verification remains active');invariant(openBlocking(t)||t.receipts.some(r=>r.code!==0),'No blocking review or failing check');t.status='repair';if(hostAuthored(t)){event(s,'host-checks-failed',{id,failing:t.receipts.filter(r=>r.code!==0).map(r=>r.id)});return;}chargeCycle(s,t);event(s,'repair',{id,cycle:t.cycles,depth:t.depth});});}
export async function accept(store:Store,id:string){await store.transaction(async s=>{const t=taskOf(s,id),hostFinal=hostAuthored(t);invariant(t.status==='review'&&t.workspace&&t.output&&(t.review||hostFinal)&&!t.activity,'Result and independent review required; verification must be idle');invariant(!unmetDependencies(s,t).length,'Unmet dependencies; reconcile upstream evidence before acceptance');const fp=await fingerprint(t.workspace);if(!hostFinal){invariant(t.review!.fingerprint===fp,'Review stale');invariant(!t.review!.findings.some(f=>f.blocking&&f.disposition==='open'),'Blocking findings remain');}invariant(t.checks.every(c=>t.receipts.some(r=>r.id===c.id&&r.code===0&&r.fingerprint===fp)),'Required checks missing, failed, or stale');if(!hostFinal)invariant(!reviewCoverageDebt(s,t).length,'Review coverage incomplete; obtain missing evidence and a corrected independent report');t.status='accepted';t.fingerprint=fp;event(s,'accepted',{id,fp,hostFinal:hostFinal||undefined});});}
async function acceptedWorkspaceFingerprint(t:Task){
 invariant(t.workspace,'Accepted task has no workspace');
 try{return await fingerprint(t.workspace);}
 catch(error){if(!workspaceUnavailable(error))throw error;throw new Error(`Task ${t.id}'s workspace ${t.workspace} is gone (${(error as NodeJS.ErrnoException).code}). integrated compares that checkout with the output that was accepted, so record integrated before removing a task worktree. Restore the worktree at the accepted commit, then run integrated again`);}
}
export async function integrated(store:Store,id:string,evidence:string){await store.transaction(async s=>{const t=taskOf(s,id);invariant(t.status==='accepted'&&evidence,'Accepted task and integration evidence required');invariant(t.fingerprint===await acceptedWorkspaceFingerprint(t),'Accepted workspace changed');t.integrated=await fingerprint(s.workspace);event(s,'integrated',{id,evidence,fingerprint:t.integrated});s.integrationReceipts=[];});}
export async function finishRun(s:Run,claims:string[]){invariant(!s.effort?.request,'Host effort pass is unfinished');invariant(s.tasks.length,'Incomplete tasks: none is planned');const incomplete=s.tasks.filter(t=>t.status!=='accepted'||!t.integrated);invariant(!incomplete.length,`Incomplete tasks: ${incomplete.map(t=>`${t.id} (${t.status==='accepted'?'accepted, integrated not recorded':t.status})`).join(', ')}`);const fp=await fingerprint(s.workspace);invariant(s.tasks.some(t=>t.integrated===fp),'Integrated content changed after recorded integration');invariant(!s.decisions.some(d=>!d.choice),'Unresolved semantic decision');invariant(s.integrationChecks.every(c=>s.integrationReceipts.some(r=>r.id===c.id&&r.code===0&&r.fingerprint===fp)),'Integration checks missing, failed or stale');invariant(Array.isArray(claims)&&claims.length===s.criteria.length&&claims.every(c=>typeof c==='string'&&c.trim()),'Evidence explanation required for every outcome');s.acceptance={fingerprint:fp,claims};s.status='complete';event(s,'finished',s.acceptance);}
export async function finish(store:Store,claims:string[]){await store.transaction(async s=>await finishRun(s,claims));}
const workspaceUnavailable=(error:unknown)=>['ENOENT','ENOTDIR','EACCES','EPERM'].includes((error as NodeJS.ErrnoException).code??'');
function quarantineWorkspace(s:Run,id:string,reason:string){
 const affected=new Set([id]);let changed=true;
 while(changed){changed=false;for(const t of s.tasks)if(!affected.has(t.id)&&t.deps.some(dep=>affected.has(dep))){affected.add(t.id);changed=true;}}
 const live:string[]=[];
 for(const t of s.tasks)if(affected.has(t.id)){
  if(t.status==='running'||t.activity){live.push(t.id);continue;}
  if(t.status==='blocked')continue;
  t.status='blocked';t.blocked=`Workspace recovery required for ${id}: ${reason}`;t.integrated=undefined;t.receipts=[];t.review=undefined;
 }
 s.integrationReceipts=[];event(s,'workspace-unavailable',{id,reason,affected:[...affected],live});
}
export async function resume(store:Store,host?:Run['host']){
 const existing=await store.load();if(existing.status==='complete')return next(store);
 await store.transaction(async s=>{
  s.status='active';s.blocked=undefined;
  if(host){invariant(host.kind&&host.model,'Actual resumed host identity required');if(host.model!==s.host.model||host.kind!==s.host.kind){invariant(!s.effort?.request,'Reconcile active effort execution before switching hosts');s.effort=undefined;}event(s,'host-resumed',{previous:s.host,current:host});s.host=host;}
  for(const t of s.tasks)if(t.status==='running'&&t.owner&&!ownerAlive(t.owner)){t.status='blocked';t.blocked='Interrupted operation: reconcile artifacts and side effects before requeue';t.owner=undefined;}
  for(const t of s.tasks)if(t.activity&&!ownerAlive(t.activity.owner)){event(s,'activity-interrupted',{id:t.id,activity:t.activity});t.activity=undefined;t.status='blocked';t.blocked='Interrupted verification: reconcile artifacts and side effects before requeue';}
  for(const d of openDelegations(s))if(!d.alive)event(s,'delegate-finished',{id:d.id,outcome:'interrupted'});
  const stale:string[]=[],unavailable:{id:string;reason:string}[]=[];for(const t of s.tasks)if(['review','accepted'].includes(t.status)&&t.workspace){try{const fp=await fingerprint(t.workspace);if(t.status==='accepted'&&t.fingerprint!==fp)stale.push(t.id);}catch(error){if(!workspaceUnavailable(error))throw error;unavailable.push({id:t.id,reason:(error as Error).message});}}
  for(const fault of unavailable)if(['review','accepted'].includes(taskOf(s,fault.id).status))quarantineWorkspace(s,fault.id,fault.reason);
  for(const id of stale)if(taskOf(s,id).status==='accepted')invalidateTree(s,id,'Accepted workspace changed since verification',undefined,true);
  event(s,'resumed',{});
 });return next(store);
}
export async function packet(store:Store,id?:string){
 const s=await store.load(),t=id?taskOf(s,id):undefined;
 const decision=(d:Decision)=>({id:d.id,question:d.question,choice:d.choice,answer:d.choice?d.criteria[d.choice]:undefined,reason:d.reason,artifact:d.artifact});
 const common={run:s.id,host:s.host,intent:s.intent,criteria:s.criteria,constraints:s.constraints,artifactDirectory:join(store.root,'artifacts')};
 if(t){
  const relevant=new Set([t.id]);const visit=(id:string)=>{for(const dep of taskOf(s,id).deps)if(!relevant.has(dep)){relevant.add(dep);visit(dep);}};visit(t.id);
  return {...common,task:t,reopened:reopenReasons(s,t.id),decisions:s.decisions.filter(d=>{
   const routing=(d.state as any)?.routing;
   // Unscoped intent/technical decisions are retained; never discard them by recency.
   return d.choice&&(!routing?.scope?.taskId||relevant.has(routing.scope.taskId));
  }).map(decision),dependencies:s.tasks.filter(d=>d.id!==t.id&&relevant.has(d.id)).map(d=>({id:d.id,goal:d.goal,criteria:d.criteria,status:d.status,output:d.output,review:d.review?.artifact,integrated:d.integrated})),
  durableState:join(store.root,`revision-${String(s.revision).padStart(9,'0')}.json`)};
 }
 return {...common,effort:s.effort,modelPools:s.modelPools,decisions:s.decisions.filter(d=>d.choice).map(decision),phaseStatus:s.tasks.map(t=>({id:t.id,phase:t.phase,status:t.status,deps:t.deps,integrated:!!t.integrated})),next:await next(store)};
}
export async function summarize(workspace:string,id:string):Promise<RunSummary>{const s=await new Store(workspace,id).load();return {id:s.id,status:s.status,intent:s.intent,criteria:s.criteria,tasks:s.tasks.length,revision:s.revision,continues:s.lineage?.continues,acceptance:s.acceptance};}

export function invalidateTree(s:Run,id:string,reason:string,feedback?:number,isDefect?:boolean){
 invariant(reason,'Invalidation reason required');taskOf(s,id);const affected=new Set([id]);let changed=true;while(changed){changed=false;for(const t of s.tasks)if(!affected.has(t.id)&&t.deps.some(dep=>affected.has(dep))){affected.add(t.id);changed=true;}}
 invariant(!s.tasks.some(t=>affected.has(t.id)&&(t.status==='running'||!!t.activity)),'Affected task is still running; reconcile ownership before invalidation');
 const reverified:string[]=[];
 for(const t of s.tasks)if(affected.has(t.id)){
  const own=t.id===id,failed=failedAttempt(t)&&!hostAuthored(t);
  // The reopened task is charged only for a defect: amend alone knows whether its next
  // worker run is a repair. A dependent is charged only when its own last attempt failed,
  // because its next worker run repairs that failure; otherwise it keeps its output.
  const charged=feedback===undefined&&(own?!!(t.output||t.review)&&isDefect!==false:failed);
  const keepsOutput=!own&&!!t.output&&(t.status==='accepted'||t.status==='review'&&!failed);
  if(charged)chargeCycle(s,t);
  t.status=keepsOutput?'review':'ready';t.integrated=undefined;t.receipts=[];t.review=undefined;
  if(keepsOutput)reverified.push(t.id);
 }
 s.integrationReceipts=[];event(s,'invalidated',{id,reason,affected:[...affected],reverified,feedback,kind:feedback===undefined?isDefect===false?'contract':'defect':'feedback'});
}

type ReopenInput={id:string;reason:string;check?:Check;noProbe?:string;feedback?:boolean};
function validateReopen(s:Run,input:ReopenInput){
 const t=taskOf(s,input.id),noProbe=typeof input.noProbe==='string'?input.noProbe.trim():'';
 invariant(!(input.check&&noProbe),'Pass check or noProbe, not both');
 const fromFeedback=input.feedback===true?feedbackReopen(s,t.id):undefined;
 if(fromFeedback===undefined)requireShaped(s,'invalidate');
 if((t.output||t.review)&&fromFeedback===undefined)invariant(input.check||noProbe,`Reopening ${t.id} needs the probe that found the defect: pass check with the executable that shows it, so every later repair of this task runs it too, or noProbe naming why no executable can show it`);
 const earlierNoProbe=s.events.find(e=>e.type==='reopen-probe'&&(e.detail as {id?:string;noProbe?:string}).id===t.id&&(e.detail as {noProbe?:string}).noProbe);
 invariant(!noProbe||!earlierNoProbe,`${t.id} was already reopened once without a probe ("${(earlierNoProbe?.detail as {noProbe?:string})?.noProbe}"). A second defect the checks cannot see means the checks are missing something: register the probe that shows it as check`);
 const same=input.check&&t.checks.find(c=>c.id===input.check!.id);
 if(input.check){
  taskCheckId(input.check.id);validCommand(input.check);validRole(input.check,t.id);
  invariant(!same||JSON.stringify([same.command,same.args,same.role])===JSON.stringify([input.check.command,input.check.args,input.check.role]),`Task ${t.id} already has a different check named ${input.check.id}`);
 }
 return {t,noProbe,fromFeedback,same};
}
export async function invalidate(store:Store,input:ReopenInput){
 const before=validateReopen(await store.load(),input);
 if(input.check?.role==='probe'&&before.t.workspace){
  let code:number;try{code=(await execute(input.check,before.t.workspace)).code;}catch{code=1;}
  invariant(code!==0,`Probe check ${input.check.id} already passes on the current checkout (${before.t.workspace}); a probe that passes there cannot detect the defect, so the reopen is refused`);
 }
 await store.transaction(s=>{
 const {t,noProbe,fromFeedback,same}=validateReopen(s,input);
 if(input.check&&!same)t.checks.push({id:input.check.id,command:input.check.command,args:input.check.args,role:input.check.role});
 invalidateTree(s,input.id,input.reason,fromFeedback,true);
 if(input.check||noProbe)event(s,'reopen-probe',{id:t.id,check:input.check,noProbe:noProbe||undefined});
});}
const amendedFields=['title','goal','phase','deps','resources','criteria','checks','kind'] as const;
const changesOnly=(t:Task,next:TaskInput,allowed:readonly (typeof amendedFields[number])[])=>amendedFields.every(key=>allowed.includes(key)||JSON.stringify(t[key])===JSON.stringify(next[key]))&&(next.noProbe===undefined||next.noProbe===t.noProbe);
const awaitingVerdict=(t:Task)=>!!t.output&&(t.status==='review'||t.status==='repair'&&hostAuthored(t));
const failedAttempt=(t:Task)=>t.status==='review'&&(t.receipts.some(r=>r.code!==0&&r.id!==scopeCheckId)||openBlocking(t));
export async function amend(store:Store,input:{id:string;reason:string;task:TaskInput;feedback?:boolean}){await store.transaction(s=>{
 invariant(input.task.id===input.id,'Amend retains task identity');
 const fromFeedback=input.feedback===true?feedbackReopen(s,input.id):undefined;
 if(fromFeedback===undefined)requireShaped(s,'amend');
 const before=taskOf(s,input.id),answersQuestion=contractQuestions(s,before).length>0;
 const keepsOutput=fromFeedback===undefined&&awaitingVerdict(before)&&!openBlocking(before)&&changesOnly(before,input.task,answersQuestion?['resources','checks']:['resources']);
 const charged=fromFeedback===undefined&&!answersQuestion&&!keepsOutput&&failedAttempt(before);
 answerScopeQuestion(s,before,'amend');
 answerContractQuestions(s,before,'amend',input.reason);
 invalidateTree(s,input.id,input.reason,fromFeedback,false);
 const t=taskOf(s,input.id);
 for(const key of amendedFields)(t as any)[key]=input.task[key];
 if(input.task.noProbe!==undefined)(t as any).noProbe=input.task.noProbe;
 validateTasks(s.tasks);validateContract(input.task);
 if(keepsOutput)t.status='review';
 if(charged)chargeCycle(s,t);
 event(s,'contract-amended',{id:input.id,reason:input.reason,keepsOutput,charged,answersQuestion});
});}

export type ParallelAction={task:string;action:string;workspace?:string;resources:string[];checks?:Check[];[key:string]:unknown};
export async function next(store:Store){
 const s=await store.load();
 const reviewed=s.status==='active'?s.tasks.filter(t=>t.status==='review'):[];
 const reviewActions=new Map(await Promise.all(reviewed.map(async t=>[t.id,await reviewAction(s,t)] as const)));
 const action=await nextAction(s,reviewActions);
 const running=activeTasks(s);
 const ready=s.tasks.filter(t=>t.status==='ready'&&!unmetDependencies(s,t).length);
 const actions=s.tasks.flatMap<ParallelAction>(t=>{
  if(s.status!=='active')return [];
  const scope={task:t.id,workspace:t.workspace,resources:t.resources};
  if(t.status==='review')return [{...scope,...reviewActions.get(t.id)!}];
  if(t.status==='repair')return [{...scope,action:'repair',depth:t.depth,cycles:t.cycles}];
  if(t.status==='accepted'&&!t.integrated)return [{...scope,workspace:s.workspace,action:'integrate'}];
  return [];
 });
 // A suggested verification batch, not permission to run simultaneous integration or conflicting checks.
 const independent:typeof actions=[];const used:Task[]=[...running];
 for(const item of actions){const t=taskOf(s,item.task);if(!['check','review'].includes(item.action??'')||!t.workspace||used.some(other=>conflict(t,other)))continue;
  if(independent.length>=Math.max(0,s.config.maxWorkers-running.length))break;independent.push(item);used.push(t);
 }
 return {...action,parallel:s.status==='active'?{available:Math.max(0,s.config.maxWorkers-running.length),ready:ready.map(t=>({id:t.id,goal:t.goal,resources:t.resources})),running:running.map(t=>{const owner=t.activity?.owner??t.owner;return {id:t.id,owner,kind:t.activity?.kind??'worker',alive:!!owner&&ownerAlive(owner)};}),delegations:openDelegations(s),actions,independent}:undefined};
}
