import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { linkedWorktree, recordsHome, runFolders } from '../scripts/records.ts';
import { clearCut } from './execution-fixture.ts';

const identity=['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','init.defaultBranch=main'];
const git=(cwd:string,...args:string[])=>execFileSync('git',[...identity,...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const same=(left:string,right:string)=>left.replace(/\\/g,'/').toLowerCase()===right.replace(/\\/g,'/').toLowerCase();

async function checkouts(t:any){
 const root=await mkdtemp(join(tmpdir(),'amaleh-records-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const main=join(root,'main'),linked=join(root,'disposable','counteasy');
 mkdirSync(main);git(main,'init','-q','-b','main');
 writeFileSync(join(main,'app.txt'),'first\n');git(main,'add','.');git(main,'commit','-q','-m','seed');
 git(main,'worktree','add','-q','-b','codex-task',linked);
 return {root,main:await realpath(main),linked:await realpath(linked)};
}
const startRun=(workspace:string,id:string,intent='Build the reports screen')=>c.start(workspace,{id,shape:clearCut,host:{kind:'codex',model:'fixture-host'},intent,criteria:['Reports screen built'],unrelated:'fixture'});

test('a run started in a linked worktree keeps its records in the main checkout',async t=>{
 const {main,linked}=await checkouts(t);
 assert.ok(same(linkedWorktree(linked)!.main,main));
 assert.equal(linkedWorktree(main),undefined,'the main checkout is not a linked worktree');
 const store=await startRun(linked,'approved-reports');
 assert.ok(same(store.amalehDir,join(main,'.amaleh')));
 const state=await store.load();
 assert.ok(same(state.workspace,linked),'the run still works in the linked worktree');
 assert.ok(state.events.some(e=>e.type==='records-in-main-checkout'));
 assert.equal(git(main,'status','--porcelain'),'','the records do not show as untracked files in the main checkout');
 assert.match(await readFile(join(main,'.git','info','exclude'),'utf8'),/^\/\.amaleh\/$/m);
});

test('records survive the linked worktree and a new worktree can continue the run',async t=>{
 const {root,main,linked}=await checkouts(t);
 await startRun(linked,'approved-reports');
 git(main,'worktree','remove','--force',linked);
 assert.ok(existsSync(join(main,'.amaleh','runs','approved-reports')));
 const next=join(root,'disposable','next');
 git(main,'worktree','add','-q','-b','codex-next',next);
 const continued=await c.start(await realpath(next),{id:'approved-reports-2',shape:clearCut,host:{kind:'codex',model:'fixture-host'},intent:'Fix the reports screen',criteria:['Reports screen fixed'],continues:'approved-reports'});
 assert.equal((await continued.load()).lineage?.continues,'approved-reports');
});

test('a run whose records already sit in the linked worktree keeps them there',async t=>{
 const {main,linked}=await checkouts(t);
 mkdirSync(join(linked,'.amaleh','runs','legacy'),{recursive:true});
 const store=new c.Store(linked,'legacy');
 assert.ok(same(store.amalehDir,join(linked,'.amaleh')));
 assert.ok(same(new c.Store(linked,'fresh').amalehDir,join(main,'.amaleh')));
 assert.deepEqual(runFolders(linked).map(f=>same(f,join(main,'.amaleh','runs'))||same(f,join(linked,'.amaleh','runs'))),[true,true]);
});

test('a plain checkout and a folder outside Git keep their own records',async t=>{
 const {root,main}=await checkouts(t);
 assert.ok(same(recordsHome(main),join(main,'.amaleh')));
 const plain=join(root,'plain');mkdirSync(plain);
 assert.ok(same(recordsHome(plain),join(plain,'.amaleh')));
 assert.deepEqual(runFolders(plain).length,1);
});

test('a workspace inside a linked worktree keeps the same relative folder in the main checkout',async t=>{
 const {main,linked}=await checkouts(t);
 const app=join(linked,'apps','mobile');mkdirSync(app,{recursive:true});
 assert.ok(same(recordsHome(app),join(main,'apps','mobile','.amaleh')));
});
