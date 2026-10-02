import {hostname} from 'node:os';
import {Store,taskOf,unmetDependencies,requireShaped,event,next,invariant,openDrive,type Run,type Task} from './core.ts';
import {delegate} from './delegate.ts';
import {integrateTask,taskWorktree} from './worktrees.ts';
import {resourceSetsOverlap} from './resources.ts';

export type DriveInput={briefs?:Record<string,string>;lenses?:string[];skills?:string[];references?:string[]};
type DriveDeps=Parameters<typeof delegate>[3]&{integrate?:typeof integrateTask};
const delegable=(s:Run,t:Task)=>(t.status==='ready'||t.status==='repair'&&t.depth!=='host'||t.status==='review'&&!!t.output&&!t.activity&&!t.owner)&&!unmetDependencies(s,t).length;
export function validateDrive(s:Run,input:DriveInput){
 requireShaped(s,'drive');
 invariant(!openDrive(s)?.alive,`Run ${s.id} already has a live drive; wait for it with wait and "until":"drive"`);
 invariant(input.briefs===undefined||input.briefs!==null&&typeof input.briefs==='object'&&!Array.isArray(input.briefs)&&Object.values(input.briefs).every(b=>typeof b==='string'&&!!b.trim()),'drive briefs must map task ids to non-empty brief strings');
 for(const id of Object.keys(input.briefs??{}))taskOf(s,id);
}

// See references/execution.md#drive
export async function drive(store:Store,input:DriveInput={},deps:DriveDeps={}){
 await store.transaction(s=>{validateDrive(s,input);event(s,'drive-started',{pid:process.pid,host:hostname()});});
 const integrate=deps.integrate??integrateTask;
 const running=new Map<string,Promise<void>>(),handedBack=new Map<string,Record<string,unknown>>(),accepted:Record<string,unknown>[]=[],integrated:string[]=[];
 const chunk=async(t:Task)=>{
  try{
   if(!t.workspace)await taskWorktree(store,{id:t.id});
   const {trail:_trail,...outcome}=await delegate(store,t.id,{brief:input.briefs?.[t.id],lenses:input.lenses,skills:input.skills,references:input.references},deps);
   if(outcome.outcome==='accepted')accepted.push(outcome);else handedBack.set(t.id,outcome);
  }catch(error){handedBack.set(t.id,{task:t.id,outcome:'failed',reason:(error as Error).message});}
  finally{running.delete(t.id);}
 };
 let failure:string|undefined;
 try{
  for(;;){
   let s=await store.load(),progressed=false;
   if(s.status!=='active')break;
   for(const t of s.tasks.filter(t=>t.status==='accepted'&&!t.integrated&&!handedBack.has(t.id))){
    const merged=await integrate(store,t.id);
    if(merged.integrated){integrated.push(t.id);progressed=true;}
    else handedBack.set(t.id,{task:t.id,outcome:'integration-needed',stage:merged.stage,reason:merged.reason,files:merged.files});
   }
   s=await store.load();
   for(const t of s.tasks){
    if(running.size>=s.config.maxWorkers)break;
    if(running.has(t.id)||handedBack.has(t.id)||!delegable(s,t)||[...running.keys()].some(id=>resourceSetsOverlap(taskOf(s,id).resources,t.resources)))continue;
    running.set(t.id,chunk(t));progressed=true;
   }
   if(running.size)await Promise.race(running.values());
   else if(!progressed)break;
  }
 }catch(error){failure=(error as Error).message;await Promise.all(running.values());}
 const tasks=(await store.load()).tasks;
 const report={outcome:!failure&&tasks.length&&tasks.every(t=>t.status==='accepted'&&t.integrated)?'ready-to-verify':'host-needed',...(failure?{failure}:{}),accepted,integrated,handedBack:[...handedBack.values()]};
 const artifact=await store.artifact(report);
 await store.transaction(s=>event(s,'drive-finished',{outcome:report.outcome,report:artifact}));
 return {...report,next:await next(store)};
}
