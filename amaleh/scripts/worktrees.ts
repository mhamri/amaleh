import { execFile } from 'node:child_process';
import { readFile, writeFile, readdir, rmdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import * as core from './core.ts';
import { resolvedDefault, type BaseCheck } from './base.ts';

export const ignoreProbe='.amaleh/worktrees/probe';
export const ignoreLine='/.amaleh/';
export const ignoreMessage='Ignore Amaleh run state and task worktrees';
export const worktreeFolderName=join('.amaleh','worktrees');
export const branchPrefix='amaleh/';

type GitRun={code:number;stdout:string;stderr:string};
const git=(cwd:string,args:string[]):Promise<GitRun>=>new Promise((done,fail)=>execFile('git',args,{cwd,maxBuffer:104857600,windowsHide:true},(error,stdout,stderr)=>{
 const code=(error as (NodeJS.ErrnoException&{code?:number|string})|undefined)?.code;
 if(error&&typeof code==='number'){done({code,stdout:stdout??'',stderr:stderr??''});return;}
 if(error)fail(error);else done({code:0,stdout:stdout??'',stderr:stderr??''});
}));
const out=(r:GitRun)=>r.stdout.split('\n').map(l=>l.endsWith('\r')?l.slice(0,-1):l);
const trim=(r:GitRun)=>out(r).join('\n').trim();
const failure=(r:GitRun)=>(r.stderr.split('\n').map(l=>l.endsWith('\r')?l.slice(0,-1):l).join('\n').trim()||trim(r));
const key=(path:string)=>resolve(path).split(sep).join('/').toLowerCase();
const label=(r:{remote:string;branch:string})=>`${r.remote}/${r.branch}`;

async function workTree(workspace:string):Promise<string>{
 const dir=await realpath(workspace);
 const inside=await git(dir,['rev-parse','--is-inside-work-tree']);
 core.invariant(inside.code===0&&trim(inside)==='true',`${dir} is not a Git work tree, so Git worktrees cannot be used there`);
 return dir;
}

export type DefaultBranch={remote:string;branch:string}|{skip:string}|{fail:string};
async function defaultOf(dir:string,base?:BaseCheck):Promise<DefaultBranch>{
 if(base?.status==='verified')return {remote:base.remote,branch:base.branch};
 if(base?.status==='unverified'||base?.status==='override')return {skip:base.reason};
 const r=await resolvedDefault(dir);
 if('fail'in r)return {fail:r.fail};
 if('skip'in r)return {skip:r.skip};
 return {remote:r.remote,branch:r.branch};
}

export type WorktreeFolderCheck={status:'committed';commit:string}|{status:'ignored'}|{status:'unverified';reason:string};
export async function ensureWorktreeFolder(workspace:string,base?:BaseCheck):Promise<WorktreeFolderCheck>{
 let dir:string;
 try{dir=await realpath(workspace);}catch(error){return {status:'unverified',reason:`The workspace ${workspace} cannot be read (${(error as Error).message}), so no ignore rule could be verified`};}
 const inside=await git(dir,['rev-parse','--is-inside-work-tree']);
 if(inside.code!==0||trim(inside)!=='true')return {status:'unverified',reason:`${dir} is not a Git work tree, so the ${worktreeFolderName} folder cannot be made ignored in the project itself`};
 if((await git(dir,['check-ignore','-q',ignoreProbe])).code===0)return {status:'ignored'};
 const head=await git(dir,['symbolic-ref','--quiet','--short','HEAD']),defaultBranch=await defaultOf(dir,base);
 if(head.code!==0){const detached='remote'in defaultBranch?`git switch -c <branch> ${label(defaultBranch)}`:`git switch -c <branch>`;throw new Error(`The workspace ${dir} is on a detached HEAD, so start cannot commit the ${worktreeFolderName} ignore line to a branch. Create a run branch with [${detached}], then start again`);}
 const branch=trim(head);
 if('fail'in defaultBranch)throw new Error(defaultBranch.fail);
 const target='skip'in defaultBranch?`git switch -c ${branch}`:`git switch -c ${branch} ${label(defaultBranch)}`;
 if(!('skip'in defaultBranch)&&(branch===defaultBranch.branch||branch===label(defaultBranch)))throw new Error(`The workspace ${dir} is on ${label(defaultBranch)}, the remote default branch, and start must not commit the ${worktreeFolderName} ignore line to it. Create a run branch with [${target}], then start again`);
 const uncommitted=trim(await git(dir,['status','--porcelain','--','.gitignore'])).split('\n').map(l=>l.trim()).filter(Boolean);
 if(uncommitted.length)throw new Error(`.gitignore has uncommitted changes in ${dir} (${uncommitted.join(', ')}), so start cannot commit the ${ignoreLine} ignore line alone. Commit or stash them, or start again from a clean checkout of the run branch`);
 const path=join(dir,'.gitignore');
 let content:string;
 try{content=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;content='';}
 if(content&&!content.endsWith('\n'))content+='\n';
 await writeFile(path,content+ignoreLine+'\n');
 const add=await git(dir,['add','--','.gitignore']);
 if(add.code!==0)throw new Error(`git add of .gitignore failed: ${failure(add)}`);
 const commit=await git(dir,['commit','-m',ignoreMessage,'--','.gitignore']);
 if(commit.code!==0)throw new Error(`git commit of the ${ignoreLine} ignore line failed: ${failure(commit)}`);
 return {status:'committed',commit:trim(await git(dir,['rev-parse','HEAD']))};
}
export async function recordWorktreeFolder(store:core.Store,check:WorktreeFolderCheck){
 await store.transaction(s=>core.event(s,'worktree-folder',check));
}

export type TaskWorktree={id:string;workspace:string;branch:string;base:string;created:boolean};
export async function taskWorktree(store:core.Store,input:{id:string;base?:string}):Promise<TaskWorktree>{
 const state=await store.load(),dir=await workTree(state.workspace);
 const id=typeof input?.id==='string'?input.id.trim():'';
 core.invariant(id,'worktree needs the id of a planned task');
 const ignored=await git(dir,['check-ignore','-q',ignoreProbe]);
 core.invariant(ignored.code===0,`${worktreeFolderName} is not ignored in ${dir}. Run start on a run branch first; it commits the ${ignoreLine} ignore line as "${ignoreMessage}"`);
 const t=core.taskOf(state,id);
 core.invariant(!['running','accepted'].includes(t.status),`Task ${t.id} is ${t.status}; a running or accepted task keeps the worktree it already has. Reconcile it, or create a worktree for another task`);
 const branch=`${branchPrefix}${state.id}/${t.id}`,path=join(dir,worktreeFolderName,state.id,t.id);
 const recorded=t.workspace&&key(t.workspace)===key(path);
 if(recorded&&existsSync(path))return {id,workspace:path,branch,base:trim(await git(path,['rev-parse','HEAD'])),created:false};
 core.invariant(!t.output||!t.workspace||recorded,`Task ${t.id} holds output in ${t.workspace}, and a new worktree would not contain it. Delegate the task again in that checkout`);
 const base=typeof input.base==='string'&&input.base.trim()?input.base.trim():trim(await git(dir,['rev-parse','HEAD']));
 core.invariant(base,`No base commit for task ${t.id}: ${dir} has no HEAD`);
 const exists=(await git(dir,['rev-parse','--verify','--quiet','refs/heads/'+branch])).code===0;
 const add=exists?await git(dir,['worktree','add',path,branch]):await git(dir,['worktree','add','-b',branch,path,base]);
 if(add.code!==0)throw new Error(`git worktree add ${path} failed: ${failure(add)}`);
 const sha=trim(await git(path,['rev-parse','HEAD']));
 await store.transaction(current=>{const task=core.taskOf(current,id);task.workspace=path;core.event(current,'worktree-created',{id,path,branch,base:sha,created:true});});
 return {id,workspace:path,branch,base:sha,created:true};
}

export type WorktreeTask={run:string;id:string;status:string;integrated:boolean};
export type WorktreeEntry={path:string;branch:string|null;head:string;main:boolean;dirty:boolean;adds:boolean|null;missing:boolean;task:WorktreeTask|null;reason?:string};
export type WorktreeListing={defaultBranch:string|null;worktrees:WorktreeEntry[];reason?:string};

async function taskOwners(dir:string){
 const owners=new Map<string,{task:WorktreeTask;runStatus:string}[]>();
 const root=join(dir,'.amaleh','runs');
 let runs:string[];try{runs=await readdir(root);}catch{return owners;}
 for(const run of runs){
  let state:core.Run;
  try{const revisions=(await readdir(join(root,run))).filter(n=>/^revision-\d+\.json$/.test(n)).sort();if(!revisions.length)continue;state=JSON.parse(await readFile(join(root,run,revisions.at(-1)!),'utf8')) as core.Run;}catch{continue;}
  for(const t of state.tasks??[]){
   if(typeof t.workspace!=='string')continue;
   const entry={task:{run,id:t.id,status:t.status,integrated:!!t.integrated},runStatus:state.status};
   owners.set(key(t.workspace),[...(owners.get(key(t.workspace))??[]),entry]);
  }
 }
 return owners;
}

async function defaultTip(dir:string):Promise<{label:string|null;tip?:string;tree?:string;reason?:string}>{
 const resolved=await resolvedDefault(dir);
 if('fail'in resolved)return {label:null,reason:resolved.fail};
 if('skip'in resolved)return {label:null,reason:resolved.skip};
 const name=label(resolved),fetch=await git(dir,['fetch',resolved.remote,resolved.branch]);
 if(fetch.code!==0)return {label:name,reason:`git fetch ${name} failed: ${failure(fetch)}`};
 const tip=trim(await git(dir,['rev-parse',name]));
 if(!tip)return {label:name,reason:`git rev-parse ${name} reported no commit after fetching it`};
 return {label:name,tip,tree:trim(await git(dir,['rev-parse',`${tip}^{tree}`]))};
}

export async function listWorktrees(workspace:string):Promise<WorktreeListing>{
 const dir=await workTree(workspace);
 const listed=await git(dir,['worktree','list','--porcelain']);
 core.invariant(listed.code===0,`git worktree list failed in ${dir}: ${failure(listed)}`);
 const entries:WorktreeEntry[]=[];
 for(const line of out(listed)){
  if(!line.trim())continue;
  if(line.startsWith('worktree ')){entries.push({path:line.slice('worktree '.length),branch:null,head:'',main:entries.length===0,dirty:false,adds:null,missing:false,task:null});continue;}
  const entry=entries.at(-1);
  if(!entry)continue;
  if(line.startsWith('HEAD '))entry.head=line.slice('HEAD '.length);
  else if(line.startsWith('branch '))entry.branch=line.slice('branch '.length).replace(/^refs\/heads\//,'');
  else if(line==='detached')entry.branch=null;
 }
 const target=await defaultTip(dir),owners=await taskOwners(dir);
 for(const entry of entries){
  entry.missing=!existsSync(entry.path);
  if(entry.missing)entry.reason='The worktree directory is missing, so it can be neither clean nor compared with the default branch';
  else entry.dirty=trim(await git(entry.path,['status','--porcelain']))!=='';
  entry.task=owners.get(key(entry.path))?.[0]?.task??null;
  if(entry.missing)continue;
  if(!target.tip){entry.adds=null;entry.reason=target.reason??'No remote default branch to compare this worktree with';continue;}
  const merge=await git(dir,['merge-tree','--write-tree',target.tip,entry.head]);
  if(merge.code===0)entry.adds=out(merge)[0].trim()!==target.tree;
  else if(merge.code===1)entry.adds=true;
  else{entry.adds=null;entry.reason=`git merge-tree --write-tree ${target.label} ${entry.head} failed: ${failure(merge)}`;}
 }
 return {defaultBranch:target.label,worktrees:entries,...(target.reason?{reason:target.reason}:{})};
}

export type CleanResult={path:string;branch:string|null;branchDeleted:boolean};

async function pruneEmptyFolders(dir:string,path:string){
 const root=key(join(dir,worktreeFolderName));
 let current=dirname(path);
 while(key(current).startsWith(root+'/')){
  try{if((await readdir(current)).length)return;await rmdir(current);}catch{return;}
  current=dirname(current);
 }
}

export async function cleanWorktrees(workspace:string,input:{paths?:string[];userInstruction?:string;deleteBranches?:boolean}){
 const dir=await workTree(workspace);
 const userInstruction=typeof input?.userInstruction==='string'?input.userInstruction.trim():'';
 core.invariant(userInstruction,'clean-worktrees removes worktrees, so it needs userInstruction quoting the user\'s words');
 core.invariant(Array.isArray(input.paths)&&input.paths.length,'clean-worktrees needs the absolute paths of the worktrees to remove in paths');
 const listing=await listWorktrees(dir),owners=await taskOwners(dir),problems:string[]=[],targets:WorktreeEntry[]=[];
 for(const named of input.paths){
  core.invariant(typeof named==='string'&&!!named.trim(),'Every path in clean-worktrees must be an absolute worktree path');
  const path=resolve(dir,named);
  const entry=listing.worktrees.find(w=>key(w.path)===key(path));
  if(!entry){problems.push(`${path} is not a worktree of ${dir}`);continue;}
  if(entry.main){problems.push(`${path} is the main working tree of ${dir}, not a task worktree`);continue;}
  if(!entry.missing&&entry.dirty){problems.push(`${path} has uncommitted changes, so it is not removed`);continue;}
  const owner=owners.get(key(path))?.[0];
  if(owner&&owner.runStatus!=='complete'&&!owner.task.integrated)problems.push(`${path} is the workspace of task ${owner.task.id} in run ${owner.task.run}, which is ${owner.runStatus} without an integrated record; record integrated after merging its output, or leave the worktree in place`);
  targets.push(entry);
 }
 core.invariant(!problems.length,`clean-worktrees removed nothing:\n- ${problems.join('\n- ')}`);
 const removed:CleanResult[]=[];
 for(const target of targets){
  const removal=await git(dir,['worktree','remove',target.path]);
  if(removal.code!==0)throw new Error(`git worktree remove ${target.path} failed: ${failure(removal)}`);
  let branchDeleted=false;
  if(input.deleteBranches===true&&target.branch&&target.adds===false){
   const deletion=await git(dir,['branch','-D',target.branch]);
   if(deletion.code!==0)throw new Error(`git branch -D ${target.branch} failed: ${failure(deletion)}`);
   branchDeleted=true;
  }
  await pruneEmptyFolders(dir,target.path);
  removed.push({path:target.path,branch:target.branch,branchDeleted});
 }
 return {removed};
}
