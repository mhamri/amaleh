import { existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';

type LinkedWorktree={top:string;main:string;commonDir:string};

function worktreeTop(workspace:string){
 for(let dir=resolve(workspace);;){
  if(existsSync(join(dir,'.git')))return dir;
  const up=dirname(dir);
  if(up===dir)return undefined;
  dir=up;
 }
}
function gitFileTarget(top:string){
 try{
  if(!statSync(join(top,'.git')).isFile())return undefined;
  const target=/^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(top,'.git'),'utf8'))?.[1];
  return target?resolve(top,target):undefined;
 }catch{return undefined;}
}
export function linkedWorktree(workspace:string):LinkedWorktree|undefined{
 const top=worktreeTop(workspace);
 const gitDir=top&&gitFileTarget(top);
 if(!top||!gitDir)return undefined;
 let commonDir:string;
 try{commonDir=resolve(gitDir,readFileSync(join(gitDir,'commondir'),'utf8').trim());}catch{return undefined;}
 const main=dirname(commonDir);
 if(basename(commonDir)!=='.git'||!existsSync(main))return undefined;
 return {top,main,commonDir};
}
const ownRecords=(workspace:string)=>join(resolve(workspace),'.amaleh');
export function recordsHome(workspace:string){
 const linked=linkedWorktree(workspace);
 return linked?join(linked.main,relative(linked.top,resolve(workspace)),'.amaleh'):ownRecords(workspace);
}
export function runRecords(workspace:string,runId:string){
 const own=ownRecords(workspace);
 return existsSync(join(own,'runs',runId))?own:recordsHome(workspace);
}
export const runFolders=(workspace:string)=>[...new Set([join(recordsHome(workspace),'runs'),join(ownRecords(workspace),'runs')])];

const gitIgnores=(main:string,path:string)=>new Promise<boolean>(done=>execFile('git',['-C',main,'check-ignore','-q','--',path],{windowsHide:true},error=>done(!error)));
export async function keepRecordsOutOfGit(workspace:string){
 const linked=linkedWorktree(workspace);
 if(!linked)return undefined;
 const folder=relative(linked.main,recordsHome(workspace)).split('\\').join('/');
 if(await gitIgnores(linked.main,`${folder}/runs/probe`))return undefined;
 const exclude=join(linked.commonDir,'info','exclude'),line=`/${folder}/`;
 const current=await readFile(exclude,'utf8').catch(()=>'');
 if(current.split(/\r?\n/).includes(line))return undefined;
 await mkdir(dirname(exclude),{recursive:true});
 await appendFile(exclude,(current&&!current.endsWith('\n')?'\n':'')+line+'\n');
 return {exclude,line};
}
