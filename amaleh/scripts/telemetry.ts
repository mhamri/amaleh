import { mkdir, writeFile, readdir, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { catalogCost, type PriceBook } from './pricing.ts';

const secrets = new Set<string>();
export function registerSecret(value:string){if(value.length>7)secrets.add(value);}
export function sanitize(value:unknown):unknown {
 if(typeof value==='string'){
  let safe=value;for(const secret of secrets)safe=safe.split(secret).join('[REDACTED]');
  return safe.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{8,}/g,'[REDACTED]').slice(0,4096);
 }
 if(Array.isArray(value))return value.map(sanitize);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(authorization|api[_-]?key|access|refresh|access_token|refresh_token|password|secret|credential|headers)$/i.test(key)?'[REDACTED]':sanitize(item)]));
 return value;
}
export type Trace={id:string;write:(stage:string,data?:unknown)=>Promise<void>;end:(outcome:string,data?:unknown)=>Promise<void>};
export async function trace(root:string|undefined,operation:string,metadata:unknown={}):Promise<Trace>{
 const id=randomUUID(),started=Date.now();let sequence=0;
 const write=async(stage:string,data:unknown={})=>{
  if(!root)return;
  const dir=join(root,'diagnostics');await mkdir(dir,{recursive:true});
  const row={schema:1,id,sequence:sequence++,operation,stage,at:new Date().toISOString(),elapsedMs:Date.now()-started,pid:process.pid,host:hostname(),metadata:sanitize(metadata),data:sanitize(data)};
  await writeFile(join(dir,`${id}-${String(row.sequence).padStart(6,'0')}.json`),JSON.stringify(row),{flag:'wx'});
 };
 await write('started');return {id,write,end:(outcome,data)=>write('finished',{outcome,...(data&&typeof data==='object'?data:{detail:data})})};
}
type SpeedRole='worker'|'reviewer';
type SpeedSample={at:string;model:string;role:SpeedRole;ms:number;outputTokens:number;failed?:boolean};
type ModelSpeed={model:string;role:SpeedRole;calls:number;failures:number;averageMinutes:number;longestMinutes:number;outputTokensPerCall:number;outputTokensPerSecond:number};
type SlowModel=ModelSpeed&{medianMinutes:number;times:number};
const round1=(n:number)=>Math.round(n*10)/10;
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length>>1;return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
type Operation={operation:string;outcome:string;started:string;elapsedMs:number;metadata:any;events:{stage:string;data:any}[]};
export function speedSamples(operations:Operation[]):SpeedSample[]{
 return operations.filter(o=>o.operation==='pi'&&(o.outcome==='success'||o.outcome==='failed')&&typeof o.metadata?.model==='string').map(o=>({at:o.started,model:o.metadata.model,role:o.metadata.readOnly?'reviewer':'worker',ms:o.elapsedMs,
  outputTokens:o.events.filter(e=>e.stage==='usage').reduce((sum,e)=>sum+(Number(e.data?.outputTokens)||0),0),
  ...(o.outcome==='failed'?{failed:true}:{})}));
}
export function modelSpeed(samples:SpeedSample[]):ModelSpeed[]{
 const groups=new Map<string,{model:string;role:SpeedRole;ms:number[];tokens:number;failures:number}>();
 for(const s of samples){const key=s.model+'|'+s.role,group=groups.get(key)??{model:s.model,role:s.role,ms:[],tokens:0,failures:0};group.ms.push(s.ms);group.tokens+=s.outputTokens;if(s.failed)group.failures++;groups.set(key,group);}
 return [...groups.values()].map(g=>{const total=g.ms.reduce((a,b)=>a+b,0);return {model:g.model,role:g.role,calls:g.ms.length,failures:g.failures,averageMinutes:round1(total/g.ms.length/60000),longestMinutes:round1(Math.max(...g.ms)/60000),outputTokensPerCall:Math.round(g.tokens/g.ms.length),outputTokensPerSecond:round1(g.tokens/Math.max(total/1000,1))};}).sort((a,b)=>a.role.localeCompare(b.role)||b.averageMinutes-a.averageMinutes);
}
// See references/runtime.md#diagnostic-traces
export const speedLedger=(amalehDir:string)=>join(amalehDir,'model-speed.jsonl');
const validSample=(s:any):s is SpeedSample=>s&&typeof s.at==='string'&&typeof s.model==='string'&&(s.role==='worker'||s.role==='reviewer')&&Number.isFinite(s.ms)&&Number.isFinite(s.outputTokens)&&(s.failed===undefined||typeof s.failed==='boolean');
export async function recordSpeed(amalehDir:string,sample:SpeedSample){await readSpeedSamples(amalehDir);await appendFile(speedLedger(amalehDir),JSON.stringify(sample)+'\n');}
export async function readSpeedSamples(amalehDir:string):Promise<SpeedSample[]>{
 let text:string;
 try{text=await readFile(speedLedger(amalehDir),'utf8');}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  const seeded:SpeedSample[]=[];
  for(const run of await readdir(join(amalehDir,'runs')).catch(()=>[] as string[]))seeded.push(...speedSamples((await diagnostics(join(amalehDir,'runs',run))).operations));
  await mkdir(amalehDir,{recursive:true});
  await writeFile(speedLedger(amalehDir),seeded.map(s=>JSON.stringify(s)+'\n').join(''),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  text=await readFile(speedLedger(amalehDir),'utf8');
 }
 return text.split('\n').flatMap(line=>{try{const s=JSON.parse(line);return validSample(s)?[s]:[];}catch{return [];}});
}
export async function recentSpeeds(amalehDir:string,windowMs:number,now=Date.now()){return modelSpeed((await readSpeedSamples(amalehDir)).filter(s=>now-Date.parse(s.at)<=windowMs));}
// See references/runtime.md#diagnostic-traces
export function slowModels(speeds:ModelSpeed[],peers:readonly string[],minimumCalls=3,factor=2):SlowModel[]{
 return (['worker','reviewer'] as const).flatMap(role=>{
  const measured=speeds.filter(s=>s.role===role&&s.calls>=minimumCalls&&peers.includes(s.model));if(measured.length<3)return [];
  return measured.flatMap(s=>{
   const typical=median(measured.filter(other=>other!==s).map(other=>other.averageMinutes));
   return s.averageMinutes>=factor*typical?[{...s,medianMinutes:round1(typical),times:round1(s.averageMinutes/typical)}]:[];
  });
 });
}
type SpendTally={key:string;calls:number;pricedCalls:number;turns:number;estimatedCost:number;piEstimate:number;inputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;outputTokens:number};
const reviewSession=/-review-\d+(?:-[0-9a-f]{8})?$/;
const dollars=(n:number)=>Math.round(n*1000)/1000;
const amount=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:0;};
const costSource=(t:SpendTally)=>t.pricedCalls===t.calls?'openrouter-catalog':t.pricedCalls?'mixed':'pi-estimate';
// See references/runtime.md#diagnostic-traces
export function spend(operations:Operation[],prices:PriceBook=()=>undefined){
 const tables={byModel:new Map<string,SpendTally>(),byRole:new Map<string,SpendTally>(),byTask:new Map<string,SpendTally>(),total:new Map<string,SpendTally>()};
 for(const o of operations.filter(o=>o.operation==='pi')){
  const usage=o.events.filter(e=>e.stage==='usage').map(e=>e.data),model=String(o.metadata?.model??'unknown'),session=String(o.metadata?.sessionDir??'').split(/[\\/]/).pop()||'unknown';
  const turns=usage.map(u=>({inputTokens:amount(u?.inputTokens),outputTokens:amount(u?.outputTokens),cacheRead:amount(u?.cacheRead),cacheWrite:amount(u?.cacheWrite)}));
  const piEstimate=usage.reduce((total,u)=>total+amount(u?.cost),0),catalog=catalogCost(prices(model,o.started),turns);
  const keys={byModel:model,byRole:o.metadata?.readOnly?'reviewer':'worker',byTask:session.replace(reviewSession,''),total:'total'};
  for(const [table,key] of Object.entries(keys) as [keyof typeof tables,string][]){
   const row=tables[table].get(key)??{key,calls:0,pricedCalls:0,turns:0,estimatedCost:0,piEstimate:0,inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0};
   row.calls++;row.turns+=turns.length;row.estimatedCost+=catalog??piEstimate;row.piEstimate+=piEstimate;if(catalog!==undefined)row.pricedCalls++;
   for(const u of turns){row.inputTokens+=u.inputTokens;row.cacheReadTokens+=u.cacheRead;row.cacheWriteTokens+=u.cacheWrite;row.outputTokens+=u.outputTokens;}
   tables[table].set(key,row);
  }
 }
 const rows=(m:Map<string,SpendTally>)=>[...m.values()].map(t=>{const {pricedCalls:_,...r}=t;return {...r,estimatedCost:dollars(t.estimatedCost),piEstimate:dollars(t.piEstimate),costSource:costSource(t)};}).sort((a,b)=>b.estimatedCost-a.estimatedCost);
 return {byModel:rows(tables.byModel),byRole:rows(tables.byRole),byTask:rows(tables.byTask),total:rows(tables.total)[0]};
}
const emptyTotals={operations:0,unfinished:0,failures:0,reportedCost:0,estimatedCost:0,inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0};
const sum=(rows:any[],field:string)=>rows.reduce((total,r)=>total+(Number(r.data[field])||0),0);
export async function diagnostics(root:string){
 let names:string[];try{names=await readdir(join(root,'diagnostics'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {operations:[],totals:{...emptyTotals},unreadable:[]};throw e;}
 const rows:any[]=[],unreadable:string[]=[];
 for(const name of names.filter(n=>/^[a-f0-9-]+-\d{6}\.json$/.test(n))){try{rows.push(JSON.parse(await readFile(join(root,'diagnostics',name),'utf8')));}catch{unreadable.push(name);}}
 const groups=new Map<string,any[]>();for(const row of rows){const items=groups.get(row.id)??[];items.push(row);groups.set(row.id,items);}
 const operations=[...groups.entries()].map(([id,items])=>{items.sort((a,b)=>a.sequence-b.sequence);const first=items[0],last=items.at(-1),completed=last.stage==='finished';return {id,operation:first.operation,started:first.at,elapsedMs:last.elapsedMs,outcome:completed?last.data.outcome:'unfinished (active or interrupted)',metadata:first.metadata,events:items.map(r=>({stage:r.stage,data:r.data,elapsedMs:r.elapsedMs}))};}).sort((a,b)=>a.started.localeCompare(b.started));
 const usage=rows.filter(r=>r.stage==='usage');
 const reported=usage.filter(r=>r.data.costSource==='openrouter-response'||(!r.data.costSource&&r.operation==='openrouter'));
 const estimated=usage.filter(r=>r.data.costSource==='pi-estimate'||(!r.data.costSource&&r.operation==='pi'));
 return {operations,totals:{operations:operations.length,unfinished:operations.filter(o=>o.outcome.startsWith('unfinished')).length,failures:operations.filter(o=>o.outcome==='failed').length,
  reportedCost:sum(reported,'cost'),estimatedCost:sum(estimated,'cost'),inputTokens:sum(usage,'inputTokens'),cacheReadTokens:sum(usage,'cacheRead'),cacheWriteTokens:sum(usage,'cacheWrite'),outputTokens:sum(usage,'outputTokens')},unreadable};
}
