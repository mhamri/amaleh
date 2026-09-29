import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ownerAlive } from './owner.ts';

export type CheckLockMode='shared'|'exclusive';
export const checkLockDir=(amalehDir:string)=>join(amalehDir,'check-lock');
const pollMs=250,heartbeatMs=5000,staleMs=60000,frozenMs=2*heartbeatMs;
const pause=()=>new Promise(r=>setTimeout(r,pollMs));
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const remove=(path:string)=>rm(path,{force:true,recursive:true,maxRetries:5,retryDelay:50});

async function held(path:string,judgeAge:boolean){
 let refreshed:number;
 try{refreshed=(await stat(path)).mtimeMs;}catch(e){return !missing(e);}
 if(judgeAge&&Date.now()-refreshed>=staleMs)return false;
 try{return ownerAlive(JSON.parse(await readFile(path,'utf8')));}catch(e){return !missing(e)&&!(e instanceof SyntaxError);}
}

// See references/runtime.md#check-isolation
// Every holder registers a uniquely named file, so clearing a dead holder can never
// remove a live one. A holder registers first and reads the directory second, and
// starts only when that read shows no holder it conflicts with: of two holders that
// overlap, the one that read second always sees the other. Two exclusive holders
// that see each other break the tie by name: the later name withdraws until the
// earlier one is gone, so neither waits on the other forever. A waiter whose own
// scans were frozen, as every process is while the machine sleeps, skips the age
// rule on that scan: the holder's heartbeat is just as late, not dead.
export async function withCheckLock<T>(amalehDir:string,mode:CheckLockMode,work:()=>Promise<T>):Promise<T>{
 const dir=checkLockDir(amalehDir);await mkdir(dir,{recursive:true});
 const name=`${mode==='exclusive'?'x':'s'}-${String(Date.now()).padStart(15,'0')}-${randomUUID()}.json`,path=join(dir,name);
 const register=async()=>{const temp=join(dir,`t-${randomUUID()}`);await writeFile(temp,JSON.stringify({pid:process.pid,host:hostname()}));await rename(temp,path);};
 let lastScan=Date.now();
 const holders=async(prefix:'x-'|'s-')=>{
  const now=Date.now(),judgeAge=now-lastScan<frozenMs;lastScan=now;
  const live:string[]=[];
  for(const other of (await readdir(dir)).filter(n=>n.startsWith(prefix)&&n.endsWith('.json')).sort()){
   if(other===name||await held(join(dir,other),judgeAge))live.push(other);else await remove(join(dir,other));
  }
  return live;
 };
 const heartbeat=setInterval(()=>{const now=new Date();utimes(path,now,now).catch(()=>{});},heartbeatMs);heartbeat.unref();
 try{
  if(mode==='exclusive')for(;;){
   const exclusive=await holders('x-');
   if(exclusive.some(other=>other<name)){await rm(path,{force:true});await pause();continue;}
   if(!exclusive.includes(name)){await register();continue;}
   if(exclusive.length===1&&!(await holders('s-')).length)break;
   await pause();
  }
  else for(;;){
   if(!(await holders('x-')).length){await register();if(!(await holders('x-')).length)break;await rm(path,{force:true});}
   await pause();
  }
  return await work();
 }finally{clearInterval(heartbeat);await remove(path).catch(()=>{});}
}
