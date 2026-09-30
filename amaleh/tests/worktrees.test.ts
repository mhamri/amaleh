import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { ensureWorktreeFolder, recordWorktreeFolder, taskWorktree, listWorktrees, cleanWorktrees, type WorktreeListing } from '../scripts/worktrees.ts';
import { clearCut } from './execution-fixture.ts';

const identity=['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','init.defaultBranch=main'];
const git=(cwd:string,...args:string[])=>execFileSync('git',[...identity,...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const head=(cwd:string)=>git(cwd,'rev-parse','HEAD');
const ignored=(cwd:string)=>{try{execFileSync('git',['check-ignore','-q','.amaleh/worktrees/probe'],{cwd,stdio:'ignore'});return true;}catch{return false;}};
const same=(left:string,right:string)=>left.replace(/\\/g,'/').toLowerCase()===right.replace(/\\/g,'/').toLowerCase();
const entryOf=(listing:WorktreeListing,path:string)=>listing.worktrees.find(w=>same(w.path,path));

async function scratch(t:any,name:string){const root=await mkdtemp(join(tmpdir(),`amaleh-${name}-`));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

async function repo(t:any,name:string,options:{remote?:boolean;onRunBranch?:boolean}={}){
 const root=await scratch(t,name);
 if(options.remote===false){
  const work=join(root,'work');mkdirSync(work);git(work,'init','-q','-b','main');
  writeFileSync(join(work,'app.txt'),'first\n');git(work,'add','.');git(work,'commit','-q','-m','seed');
  return {root,work:await realpath(work)};
 }
 const remote=join(root,'origin.git'),seed=join(root,'seed'),work=join(root,'work');
 git(root,'init','-q','--bare','-b','main',remote);
 mkdirSync(seed);git(seed,'init','-q','-b','main');
 writeFileSync(join(seed,'app.txt'),'first\n');writeFileSync(join(seed,'.gitignore'),'node_modules/\n');
 git(seed,'add','.');git(seed,'commit','-q','-m','seed');
 git(seed,'remote','add','origin',remote);git(seed,'push','-q','origin','main');
 execFileSync('git',['clone','-q',remote,work],{stdio:'ignore'});
 if(options.onRunBranch!==false)git(work,'switch','-q','-c','run-branch');
 return {root,work:await realpath(work)};
}

const intent='Keep every task worktree inside the project';
async function started(work:string,id:string,tasks=2){
 const folder=await ensureWorktreeFolder(work);
 const store=await c.start(work,{id,shape:clearCut,host:{kind:'codex',model:'fixture-host'},intent,criteria:['Task worktrees live inside the project']});
 await recordWorktreeFolder(store,folder);
 await c.plan(store,{tasks:Array.from({length:tasks},(_,index)=>({id:`t${index+1}`,title:`t${index+1}`,goal:'Deliver one outcome',phase:'code',deps:[],resources:['src/**'],criteria:['the outcome holds'],kind:'research' as const,checks:[]})),integrationChecks:[]});
 return store;
}

test('start makes the project ignore its worktree folder in the first commit, once',{timeout:120000},async t=>{
 const {work}=await repo(t,'folder',{onRunBranch:false});
 await assert.rejects(()=>ensureWorktreeFolder(work),/git switch -c main origin\/main/);
 assert.equal(head(work),git(work,'rev-parse','main'),'the refusal adds no commit');
 git(work,'switch','-q','-c','run-branch');
 git(work,'checkout','-q','--detach');
 await assert.rejects(()=>ensureWorktreeFolder(work),/detached HEAD[\s\S]*git switch -c <branch> origin\/main/,'a detached refusal names the remote default branch when one exists');
 git(work,'switch','-q','run-branch');
 writeFileSync(join(work,'.gitignore'),'node_modules/\nlocal-edit/\n');
 await assert.rejects(()=>ensureWorktreeFolder(work),/\.gitignore has uncommitted changes/);
 assert.match(git(work,'status','--porcelain','--','.gitignore'),/M \.gitignore$/,'the refusal leaves .gitignore as it was');
 git(work,'checkout','-q','--','.gitignore');
 assert.equal(git(work,'status','--porcelain','--','.gitignore'),'','a clean .gitignore is ready for the setup commit');
 writeFileSync(join(work,'staged.txt'),'staged\n');git(work,'add','staged.txt');
 const first=await ensureWorktreeFolder(work);
 assert.equal(first.status,'committed');
 assert.equal((first as {commit:string}).commit,head(work));
 assert.deepEqual(git(work,'show','--name-only','--format=','HEAD').split('\n').filter(Boolean),['.gitignore'],'the setup commit touches only .gitignore');
 assert.equal(git(work,'rev-list','--count',`${git(work,'rev-parse','origin/main')}..HEAD`),'1','the setup commit is the first commit of the run branch');
 assert.equal(git(work,'status','--porcelain'),'A  staged.txt','another staged change stays staged');
 const content=(await readFile(join(work,'.gitignore'),'utf8')).split('\n').map(l=>l.replace(/\r$/,''));
 assert.ok(content.includes('node_modules/'),'the existing content is kept');
 assert.ok(content.includes('/.amaleh/'),'the ignore line is appended');
 assert.equal(ignored(work),true,'.amaleh/worktrees is ignored after start');
 assert.deepEqual(await ensureWorktreeFolder(work),{status:'ignored'},'an already ignored folder commits nothing again');
 const plain=join(await scratch(t,'plain'),'plain');mkdirSync(plain);
 const unverified=await ensureWorktreeFolder(plain);
 assert.equal(unverified.status,'unverified');
 assert.ok((unverified as {reason:string}).reason,'the unverified state records why');
});

test('start with a user base override proceeds when the remote is unreachable',{timeout:120000},async t=>{
 const {root,work}=await repo(t,'override-down');
 git(work,'remote','set-url','origin',join(root,'gone.git'));
 const recovered=await ensureWorktreeFolder(work,{status:'override',reason:'Base branch explicitly set by the user',userInstruction:'Build on my current branch; it needs unmerged work'});
 assert.equal(recovered.status,'committed','the override proceeds without resolving the unreachable remote');
 assert.deepEqual(git(work,'show','--name-only','--format=','HEAD').split('\n').filter(Boolean),['.gitignore'],'the setup commit still touches only .gitignore');
});

test('start refuses an untracked .gitignore and creates a missing one',{timeout:120000},async t=>{
 const {work}=await repo(t,'untracked',{remote:false});
 writeFileSync(join(work,'.gitignore'),'local-only/\n');
 await assert.rejects(()=>ensureWorktreeFolder(work),/\.gitignore has uncommitted changes/);
 assert.equal(git(work,'status','--porcelain','--','.gitignore'),'?? .gitignore','the refusal leaves the untracked file as it was');
 await rm(join(work,'.gitignore'));
 const created=await ensureWorktreeFolder(work);
 assert.equal(created.status,'committed');
 assert.deepEqual(git(work,'show','--name-only','--format=','HEAD').split('\n').filter(Boolean),['.gitignore']);
 assert.equal((await readFile(join(work,'.gitignore'),'utf8')).replace(/\r/g,''),'/.amaleh/\n','a missing .gitignore is created with only the ignore line');
});

test('worktree creates the task checkout inside the project folder and records it',{timeout:120000},async t=>{
 const {work}=await repo(t,'create');
 const store=await started(work,'r1');
 const folder=(await store.load()).events.filter(e=>e.type==='worktree-folder').at(-1)!.detail as Record<string,unknown>;
 assert.equal(folder.status,'committed');
 assert.equal(folder.commit,head(work),'the run records the commit start made on its branch');
 const runHead=head(work),made=await taskWorktree(store,{id:'t1'});
 const path=join(work,'.amaleh','worktrees','r1','t1');
 assert.ok(same(made.workspace,path),`worktree t1 returned ${made.workspace}`);
 assert.equal(made.branch,'amaleh/r1/t1');
 assert.equal(made.created,true);
 assert.equal(made.base,runHead,'the worktree starts at the run checkout HEAD');
 assert.equal(git(path,'rev-parse','--abbrev-ref','HEAD'),'amaleh/r1/t1');
 assert.equal(c.taskOf(await store.load(),'t1').workspace,made.workspace);
 const created=(await store.load()).events.filter(e=>e.type==='worktree-created').at(-1)!.detail as Record<string,unknown>;
 assert.deepEqual(created,{id:'t1',path:made.workspace,branch:'amaleh/r1/t1',base:runHead,created:true});
 const again=await taskWorktree(store,{id:'t1'});
 assert.equal(again.created,false);
 assert.ok(same(again.workspace,made.workspace));
 assert.equal(again.base,runHead);
 const other=await taskWorktree(store,{id:'t2',base:'origin/main'});
 assert.equal(other.base,git(work,'rev-parse','origin/main'),'a named base wins over the run checkout HEAD');
 assert.equal(git(other.workspace,'rev-parse','HEAD'),other.base);
 const reopened=await taskWorktree(store,{id:'t2'});
 assert.equal(reopened.created,false,'an existing worktree is never recreated');
 await assert.rejects(()=>taskWorktree(store,{id:'ghost'}),/Unknown task/);
});

test('worktree refuses a run outside Git, an unignored folder, and a task that already holds output',{timeout:120000},async t=>{
 const plain=join(await scratch(t,'nogit'),'work');mkdirSync(plain);
 const plainStore=await started(plain,'p1');
 await assert.rejects(()=>taskWorktree(plainStore,{id:'t1'}),/not a Git work tree/);
 await assert.rejects(()=>listWorktrees(plain),/not a Git work tree/);
 const {work}=await repo(t,'refusals',{remote:false});
 const store=await c.start(work,{id:'r2',shape:clearCut,host:{kind:'codex',model:'fixture-host'},intent,criteria:['Task worktrees live inside the project']});
 await c.plan(store,{tasks:[{id:'t1',title:'t1',goal:'Deliver',phase:'code',deps:[],resources:['src/**'],criteria:['holds'],kind:'research',checks:[]}],integrationChecks:[]});
 await assert.rejects(()=>taskWorktree(store,{id:'t1'}),/start on a run branch first[\s\S]*Ignore Amaleh run state and task worktrees/);
 await ensureWorktreeFolder(work);
 const made=await taskWorktree(store,{id:'t1'});
 for(const status of ['running','accepted'] as const){
  const live=new c.Store(work,'r2');
  await live.transaction(s=>{c.taskOf(s,'t1').status=status;});
  await assert.rejects(()=>taskWorktree(live,{id:'t1'}),new RegExp(`is ${status}`));
 }
 const elsewhere=new c.Store(work,'r2');
 await elsewhere.transaction(s=>{const task=c.taskOf(s,'t1');task.status='review';task.output='prior-output';task.workspace=join(work,'elsewhere');});
 await assert.rejects(()=>taskWorktree(elsewhere,{id:'t1'}),/holds output in [\s\S]*elsewhere/);
 assert.ok(existsSync(made.workspace),'a refused call leaves the worktree it found');
});

test('worktrees reports every worktree of the project with merged and dirty state',{timeout:120000},async t=>{
 const {root,work}=await repo(t,'list');
 const store=await started(work,'r1');
 const one=await taskWorktree(store,{id:'t1'});
 writeFileSync(join(one.workspace,'scratch.txt'),'dirty\n');
 const manual=join(work,'.amaleh','worktrees','manual');
 git(work,'worktree','add','-q','-b','squashed',join(manual,'squashed'),'origin/main');
 writeFileSync(join(manual,'squashed','app.txt'),'second\n');
 git(join(manual,'squashed'),'commit','-q','-am','squashed');
 git(work,'worktree','add','-q','-b','extra',join(manual,'extra'),'origin/main');
 writeFileSync(join(manual,'extra','extra.txt'),'work\n');
 git(join(manual,'extra'),'add','extra.txt');
 git(join(manual,'extra'),'commit','-q','-m','extra');
 const rival=join(root,'rival');
 execFileSync('git',['clone','-q',join(root,'origin.git'),rival],{stdio:'ignore'});
 writeFileSync(join(rival,'app.txt'),'second\n');git(rival,'commit','-q','-am','squashed');
 git(rival,'push','-q','origin','main');
 assert.notEqual(head(join(manual,'squashed')),git(work,'rev-parse','origin/main'),'a squash-merged branch is no ancestor of the default branch');
 const listing=await listWorktrees(work);
 assert.equal(listing.defaultBranch,'origin/main');
 const main=entryOf(listing,work)!;
 assert.equal(main.main,true,'the main working tree is marked');
 assert.equal(main.task,null,'no task owns the main checkout');
 const dirtyEntry=entryOf(listing,one.workspace)!;
 assert.equal(dirtyEntry.branch,'amaleh/r1/t1');
 assert.equal(dirtyEntry.dirty,true);
 assert.equal(dirtyEntry.adds,true);
 assert.deepEqual(dirtyEntry.task,{run:'r1',id:'t1',status:'ready',integrated:false});
 const squashed=entryOf(listing,join(manual,'squashed'))!;
 assert.equal(squashed.adds,false,'a squash-merged branch adds nothing to the default branch');
 assert.equal(squashed.dirty,false);
 assert.equal(squashed.task,null,'a worktree no task owns names no task');
 assert.equal(entryOf(listing,join(manual,'extra'))!.adds,true);
 await rm(one.workspace,{recursive:true,force:true});
 const afterRemoval=await listWorktrees(work);
 const gone=entryOf(afterRemoval,one.workspace)!;
 assert.equal(gone.missing,true,'a worktree whose directory is gone is reported as missing');
 assert.equal(gone.dirty,false);
 const local=await repo(t,'list-local',{remote:false});
 const localStore=await started(local.work,'r1',1);
 const localOne=await taskWorktree(localStore,{id:'t1'});
 const loose=join(local.work,'.amaleh','worktrees','r1','loose');
 git(local.work,'worktree','add','-q',loose,'HEAD');
 git(loose,'checkout','-q','--detach');
 const withoutRemote=await listWorktrees(local.work);
 assert.equal(withoutRemote.defaultBranch,null);
 assert.equal(withoutRemote.worktrees.length,3);
 for(const entry of withoutRemote.worktrees){assert.equal(entry.adds,null);assert.ok(entry.reason,'a null adds carries its reason');}
 assert.equal(entryOf(withoutRemote,loose)!.branch,null,'a detached worktree has no branch');
 assert.equal(entryOf(withoutRemote,localOne.workspace)!.dirty,false);
});

test('a task branch whose run branch was squash-merged adds nothing, even where later tasks rewrote its lines',{timeout:120000},async t=>{
 const {root,work}=await repo(t,'stacked');
 const early=join(work,'.amaleh','worktrees','run','early');
 git(work,'worktree','add','-q','-b','amaleh/run/early',early,'origin/main');
 writeFileSync(join(early,'app.txt'),'early\n');git(early,'commit','-q','-am','early task');
 git(work,'branch','feat/run','amaleh/run/early');
 const later=join(root,'later');git(work,'worktree','add','-q',later,'feat/run');
 writeFileSync(join(later,'app.txt'),'later\n');git(later,'commit','-q','-am','later task rewrites the same line');
 const rival=join(root,'rival');
 execFileSync('git',['clone','-q',join(root,'origin.git'),rival],{stdio:'ignore'});
 writeFileSync(join(rival,'app.txt'),'later\n');git(rival,'commit','-q','-am','squash of feat/run');git(rival,'push','-q','origin','main');
 const listing=await listWorktrees(work);
 const entry=entryOf(listing,early)!;
 assert.equal(entry.adds,false,'the early task conflicts with main only because a later task in the same run rewrote its line');
 assert.equal(entry.mergedVia,'feat/run');
 git(work,'worktree','remove',later);git(work,'branch','-D','feat/run');
 const orphan=entryOf(await listWorktrees(work),early)!;
 assert.equal(orphan.adds,true,'without a merged container the conflicting branch still adds');
 assert.equal(orphan.mergedVia,undefined);
});

test('clean-worktrees removes only what the user named and only clean, integrated worktrees',{timeout:120000},async t=>{
 const {work}=await repo(t,'clean');
 const store=await started(work,'r1');
 const one=await taskWorktree(store,{id:'t1'});
 const two=await taskWorktree(store,{id:'t2'});
 const manual=join(work,'.amaleh','worktrees','manual');
 git(work,'worktree','add','-q','-b','merged',join(manual,'merged'),'origin/main');
 git(work,'worktree','add','-q','-b','work',join(manual,'work'),'origin/main');
 writeFileSync(join(manual,'work','extra.txt'),'work\n');
 git(join(manual,'work'),'add','extra.txt');
 git(join(manual,'work'),'commit','-q','-m','extra');
 const merged=join(manual,'merged'),extra=join(manual,'work');
 writeFileSync(join(one.workspace,'scratch.txt'),'dirty\n');
 await assert.rejects(()=>cleanWorktrees(work,{paths:[merged]}),/userInstruction quoting the user/);
 await assert.rejects(()=>cleanWorktrees(work,{userInstruction:'the user asked'}),/paths/);
 const refusal=await cleanWorktrees(work,{paths:[one.workspace,two.workspace,merged,extra,join(work,'not-a-worktree')],userInstruction:'the user asked for these five'}).then(()=>undefined,(error:Error)=>error.message);
 assert.match(refusal!,/removed nothing/);
 assert.match(refusal!,/has uncommitted changes/);
 assert.match(refusal!,/without an integrated record; record integrated/);
 assert.match(refusal!,/is not a worktree of/);
 assert.equal(refusal!.match(/^- /gm)!.length,3,'one refusal lists every problem');
 for(const path of [one.workspace,two.workspace,merged,extra])assert.equal(existsSync(path),true,'a refused request removes nothing');
 const mainRefusal=await cleanWorktrees(work,{paths:[work],userInstruction:'the user asked'}).then(()=>undefined,(error:Error)=>error.message);
 assert.match(mainRefusal!,/is the main working tree/);
 const removed=await cleanWorktrees(work,{paths:[merged,extra],userInstruction:'the user asked for these two',deleteBranches:true});
 assert.deepEqual(removed.removed.map(r=>({branch:r.branch,branchDeleted:r.branchDeleted})),[{branch:'merged',branchDeleted:true},{branch:'work',branchDeleted:false}]);
 assert.ok(same(removed.removed[0].path,merged)&&same(removed.removed[1].path,extra),'the report names each removed path');
 assert.equal(existsSync(merged),false);
 assert.equal(existsSync(extra),false);
 assert.equal(existsSync(manual),false,'the empty folder under .amaleh/worktrees is removed');
 assert.doesNotMatch(git(work,'branch','--list','merged'),/merged/);
 assert.match(git(work,'branch','--list','work'),/work/,'a branch that still adds a commit is kept');
 const kept=join(work,'.amaleh','worktrees','kept');
 git(work,'worktree','add','-q','-b','kept-branch',kept,'origin/main');
 const withoutDelete=await cleanWorktrees(work,{paths:[kept],userInstruction:'the user asked for this one'});
 assert.equal(withoutDelete.removed.length,1);
 assert.equal(withoutDelete.removed[0].branchDeleted,false,'without deleteBranches the branch stays');
 assert.match(git(work,'branch','--list','kept-branch'),/kept-branch/);
 git(work,'worktree','add','-q','-b','gone-branch',join(work,'.amaleh','worktrees','gone','work'),'origin/main');
 await rm(join(work,'.amaleh','worktrees','gone','work'),{recursive:true,force:true});
 const pruned=await cleanWorktrees(work,{paths:[join(work,'.amaleh','worktrees','gone','work')],userInstruction:'the user asked for this one too'});
 assert.equal(pruned.removed.length,1,'a worktree whose directory is gone is still pruned from Git');
 assert.equal(existsSync(join(work,'.amaleh','worktrees','gone')),false);
 const finished=new c.Store(work,'r1');
 await finished.transaction(s=>{const task=c.taskOf(s,'t2');task.status='accepted';task.integrated='synthetic';s.status='complete';});
 const complete=await cleanWorktrees(work,{paths:[two.workspace],userInstruction:'the user asked'});
 assert.equal(complete.removed.length,1,'a complete run no longer protects its worktree');
});
