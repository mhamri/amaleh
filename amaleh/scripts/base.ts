import {execFile} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import * as core from './core.ts';

export type BaseInstruction={userInstruction?:string};
export type BaseCheck=
 |{status:'verified';remote:string;branch:string;tip:string}
 |{status:'unverified';reason:string}
 |{status:'override';reason:string;userInstruction:string}
 |{status:'conflict';remote:string;branch:string;files:string[]};

interface GitRun{code:number;stdout:string;stderr:string}
const run=(cwd:string,args:string[]):Promise<GitRun>=>new Promise((resolve,reject)=>execFile('git',args,{cwd,maxBuffer:104857600,windowsHide:true},(error,stdout,stderr)=>{
 const code=(error as (NodeJS.ErrnoException&{code?:number|string})|undefined)?.code;
 if(error&&typeof code==='number'){resolve({code,stdout:stdout??'',stderr:stderr??''});return;}
 if(error)reject(error);else resolve({code:0,stdout:stdout??'',stderr:stderr??''});
}));

const linesOf=(text:string)=>text.split('\n').map(l=>l.endsWith('\r')?l.slice(0,-1):l);

type Resolved={dir:string}&({skip:string}|{fail:string}|{remote:string;branch:string;tip:string});
export async function resolvedDefault(workspace:string):Promise<Resolved>{
 const dir=await realpath(workspace);
 const inside=await run(dir,['rev-parse','--is-inside-work-tree']);
 if(inside.code!==0||inside.stdout.trim()==='false')return {dir,skip:'Not a Git checkout; there is no base branch to verify'};
 const remotes=await run(dir,['remote']);
 if(remotes.code!==0)return {dir,fail:`git remote failed: ${remotes.stderr.trim()}`};
 const names=remotes.stdout.split('\n').map(n=>n.trim()).filter(Boolean);
 if(!names.length)return {dir,skip:'No Git remote configured; the base branch cannot be fetched'};
 const remote=names.includes('origin')?'origin':names[0];
 const ls=await run(dir,['ls-remote','--symref',remote,'HEAD']);
 if(ls.code!==0)return {dir,fail:`git ls-remote ${remote} HEAD failed: ${(ls.stderr.trim()||ls.stdout.trim())}`};
 const branch=linesOf(ls.stdout).map(l=>/^ref: refs\/heads\/(\S+)\tHEAD$/.exec(l)?.[1]).find(Boolean);
 const tip=linesOf(ls.stdout).map(l=>/^([0-9a-f]{40,})\tHEAD$/.exec(l)?.[1]).find(Boolean);
 if(!branch||!tip)return {dir,fail:`git ls-remote ${remote} HEAD did not report a symbolic default branch; the base cannot be verified`};
 return {dir,remote,branch,tip};
}
const label=(r:{remote:string;branch:string})=>`${r.remote}/${r.branch}`;

export async function verifyStartBase(workspace:string,instruction?:BaseInstruction):Promise<BaseCheck>{
 const userInstruction=instruction?.userInstruction?.trim();
 if(userInstruction)return {status:'override',reason:'Base branch explicitly set by the user',userInstruction};
 const r=await resolvedDefault(workspace);
 if('skip'in r)return {status:'unverified',reason:r.skip};
 if('fail'in r)throw new Error(r.fail);
 const name=label(r),fetch=await run(r.dir,['fetch',r.remote,r.branch]);
 if(fetch.code!==0)throw new Error(`git fetch ${name} failed: ${fetch.stderr.trim()}`);
 const tip=(await run(r.dir,['rev-parse','FETCH_HEAD'])).stdout.trim()||r.tip;
 const contains=await run(r.dir,['merge-base','--is-ancestor',tip,'HEAD']);
 if(contains.code!==0)throw new Error(`HEAD does not contain the freshly fetched default branch ${name}. Start new work on a branch made from it with [git switch -c <branch> ${name}], or bring it into this branch with [git merge ${name}]. Pass base.userInstruction quoting the user only when the user asked for a different base`);
 return {status:'verified',remote:r.remote,branch:r.branch,tip};
}

export async function verifyFinishBase(workspace:string):Promise<BaseCheck>{
 const r=await resolvedDefault(workspace);
 if('skip'in r)return {status:'unverified',reason:r.skip};
 if('fail'in r)throw new Error(r.fail);
 const name=label(r),fetch=await run(r.dir,['fetch',r.remote,r.branch]);
 if(fetch.code!==0)throw new Error(`git fetch ${name} failed: ${fetch.stderr.trim()}`);
 const tip=(await run(r.dir,['rev-parse','FETCH_HEAD'])).stdout.trim();
 if(!tip)throw new Error(`git rev-parse FETCH_HEAD failed after fetching ${name}`);
 const merge=await run(r.dir,['merge-tree','--write-tree','--name-only','HEAD',tip]);
 if(merge.code===0)return {status:'verified',remote:r.remote,branch:r.branch,tip};
 if(merge.code!==1)throw new Error(`git merge-tree HEAD ${name} failed: ${(merge.stderr.trim()||merge.stdout.trim())}`);
 // Output: the tree oid, then the conflicted file names, then a blank line, then
 // informational merge messages. Keep only the file-name section.
 const section=linesOf(merge.stdout).slice(1),blank=section.findIndex(l=>!l.trim());
 const files=(blank===-1?section:section.slice(0,blank)).map(f=>f.trim()).filter(Boolean);
 return {status:'conflict',remote:r.remote,branch:r.branch,files};
}

export async function recordBase(store:core.Store,stage:'start'|'finish',check:BaseCheck){
 await store.transaction(s=>{
  if(check.status==='verified')core.event(s,'base-verified',{stage,remote:check.remote,branch:check.branch,tip:check.tip});
  else if(check.status==='unverified')core.event(s,'base-unverified',{stage,reason:check.reason});
  else if(check.status==='override')core.event(s,'base-override',{stage,reason:check.reason,userInstruction:check.userInstruction});
  else core.event(s,'base-conflict',{stage,remote:check.remote,branch:check.branch,files:check.files});
 });
}
