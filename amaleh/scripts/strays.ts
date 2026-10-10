import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProcessRow={pid:number;parent:number;started:number;command:string};
const listingTimeoutMs=30000;
const scriptsDir=dirname(fileURLToPath(import.meta.url));

const run=(file:string,args:string[])=>new Promise<string|undefined>(done=>execFile(file,args,{windowsHide:true,maxBuffer:256*1024*1024,timeout:listingTimeoutMs},(error,stdout)=>done(error?undefined:String(stdout))));
const windowsListing='Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;started=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString("o")}else{""});command=$_.CommandLine} } | ConvertTo-Json -Compress';
export function parseWindowsListing(text:string):ProcessRow[]{
 const rows=JSON.parse(text) as unknown;
 return (Array.isArray(rows)?rows:[rows]).flatMap((r:any)=>Number.isInteger(r?.pid)&&typeof r.command==='string'&&Date.parse(r.started)?[{pid:r.pid,parent:Number(r.parent)||0,started:Date.parse(r.started),command:r.command}]:[]);
}
export function elapsedMs(etime:string){
 const match=/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
 if(!match)return undefined;
 const [,days,hours,minutes,seconds]=match.map(Number);
 return (((days||0)*24+(hours||0))*60+minutes)*60000+seconds*1000;
}
export function parsePsListing(text:string,now:number):ProcessRow[]{
 return text.split('\n').flatMap(line=>{
  const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
  const elapsed=match?elapsedMs(match[3]):undefined;
  return match&&elapsed!==undefined?[{pid:Number(match[1]),parent:Number(match[2]),started:now-elapsed,command:match[4]}]:[];
 });
}
async function listProcesses():Promise<ProcessRow[]>{
 if(process.platform==='win32'){const text=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',windowsListing]);try{return text?parseWindowsListing(text):[];}catch{return [];}}
 const text=await run('ps',['-A','-o','pid=,ppid=,etime=,args=']);
 return text?parsePsListing(text,Date.now()):[];
}
const comparable=(text:string,platform:NodeJS.Platform)=>{const slashed=text.replace(/\\/g,'/');return platform==='win32'?slashed.toLowerCase():slashed;};
// A run's main checkout holds every task worktree under .amaleh, so a path that
// continues into .amaleh names another task's workspace, not this one.
export function namesWorkspace(command:string,workspace:string,platform:NodeJS.Platform=process.platform){
 const text=comparable(command,platform),path=comparable(workspace,platform).replace(/\/+$/,'');
 for(let at=text.indexOf(path);at>=0;at=text.indexOf(path,at+1)){
  const rest=text.slice(at+path.length);
  if(rest===''||/^["'\s]/.test(rest)||rest.startsWith('/')&&!rest.startsWith('/.amaleh/'))return true;
 }
 return false;
}
// A process the host or another tool started while the call ran can name the same
// workspace; it still has a live parent outside the call, so only processes whose
// parent died, was reparented to init, or is the call itself or another stray count.
export function strayProcesses(rows:ProcessRow[],input:{workspace:string;since:number;callPid?:number;self?:number[];platform?:NodeJS.Platform}){
 const self=new Set([process.pid,process.ppid,...(input.self??[])]),alive=new Set(rows.map(r=>r.pid));
 const candidates=rows.filter(r=>r.started>=input.since&&!self.has(r.pid)&&!namesWorkspace(r.command,scriptsDir,input.platform)&&namesWorkspace(r.command,input.workspace,input.platform));
 const strays=new Set<number>();
 for(let grew=true;grew;){
  grew=false;
  for(const r of candidates)if(!strays.has(r.pid)&&(!alive.has(r.parent)||r.parent===1||r.parent===input.callPid||strays.has(r.parent))){strays.add(r.pid);grew=true;}
 }
 return candidates.filter(r=>strays.has(r.pid));
}
const stop=(pid:number)=>process.platform==='win32'?run('taskkill',['/pid',String(pid),'/T','/F']).then(()=>{}):Promise.resolve().then(()=>{try{process.kill(pid,'SIGKILL');}catch{}});
export const ownProcessGroup=process.platform!=='win32';
export function stopProcessGroup(pid:number){
 try{process.kill(-pid,'SIGKILL');return true;}catch{return false;}
}
export async function stopStrays(input:{workspace:string;since:number;callPid?:number}){
 if(ownProcessGroup&&input.callPid)stopProcessGroup(input.callPid);
 const strays=strayProcesses(await listProcesses(),input);
 await Promise.all(strays.map(r=>stop(r.pid)));
 return strays.map(r=>({pid:r.pid,command:r.command.slice(0,300)}));
}
