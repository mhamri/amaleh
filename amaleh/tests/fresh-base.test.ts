import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, finishGate } from '../scripts/cli.ts';
import * as c from '../scripts/core.ts';
import { clearCut } from './execution-fixture.ts';

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','init.defaultBranch=main',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function staleClone(t:any){
 const root=await mkdtemp(join(tmpdir(),'amaleh-fresh-base-'));t.after(()=>rm(root,{recursive:true,force:true}));
 git(root,'init','--bare','-b','main','origin.git');
 git(root,'clone','origin.git','seed');
 const seed=join(root,'seed');
 await writeFile(join(seed,'app.txt'),'first');git(seed,'add','app.txt');git(seed,'commit','-m','first');git(seed,'push','origin','main');
 git(root,'clone','origin.git','work');
 const work=join(root,'work');
 git(work,'switch','-q','-c','run-branch');
 await writeFile(join(seed,'app.txt'),'second');git(seed,'commit','-am','second');git(seed,'push','origin','main');
 return {root,work:join(root,'work')};
}
async function startInput(root:string,name:string,extra:Record<string,unknown>={}){
 const path=join(root,name+'.json');
 await writeFile(path,JSON.stringify({shape:clearCut,host:{kind:'codex',model:'gpt-6-astra'},intent:'Fixture run '+name,criteria:['observable result'],...extra}));
 return path;
}

test('start refuses a checkout that does not contain the freshly fetched origin default branch',{timeout:180000},async t=>{
 const {root,work}=await staleClone(t);
 const input=await startInput(root,'stale');
 await assert.rejects(()=>main(['start',work,'stale',input]),/origin\/main/);
});

test('start accepts the stale checkout when the user asked for a different base',{timeout:60000},async t=>{
 const {root,work}=await staleClone(t);
 const instruction='Build on my current branch; it needs unmerged work';
 await main(['start',work,'stacked',await startInput(root,'stacked',{base:{userInstruction:instruction}})]);
 const s=await new c.Store(work,'stacked').load();
 const overrides=s.events.filter(e=>e.type==='base-override');
 assert.equal(overrides.length,1,'Exactly one base-override event');
 assert.equal((overrides[0].detail as any).userInstruction,instruction,'The override event quotes the user instruction');
});

test('start accepts a checkout that contains the fetched origin default branch',{timeout:60000},async t=>{
 const {root,work}=await staleClone(t);
 git(work,'pull','--ff-only','origin','main');
 await main(['start',work,'fresh',await startInput(root,'fresh')]);
});

const finishTask=(id:string,deps:string[]=[]):c.TaskInput=>({
 id,title:id,goal:'Correct observable behavior',phase:'checkout',deps,resources:[id],
 criteria:['correct result'],kind:'code' as const,
 checks:[{id:'test',command:process.execPath,args:['-e','process.exit(0)'],role:'guard' as const}],
 noProbe:'Test fixture; the base gate itself is the behavior under test',
});
async function planFor(store:c.Store){await c.plan(store,{tasks:[finishTask('a')],integrationChecks:[]});}
async function deliverOnly(store:c.Store,dir:string){
 await planFor(store);
 await store.transaction(async s=>{
  const t=c.taskOf(s,'a');t.status='accepted';const fp=await c.fingerprint(dir);
  t.integrated=fp;t.fingerprint=fp;t.checks.forEach(check=>t.receipts.push({id:check.id,code:0,fingerprint:fp,artifact:''}));
 });
}

test('finishGate refuses a checkout that conflicts with the freshly fetched origin default branch',{timeout:60000},async t=>{
 const {root,work}=await staleClone(t);
 git(work,'pull','--ff-only','origin','main');
 await main(['start',work,'conflict',await startInput(root,'conflict')]);
 const rival=join(root,'rival');git(root,'clone','origin.git','rival');
 await writeFile(join(rival,'app.txt'),'rival');git(rival,'commit','-am','rival');git(rival,'push','origin','main');
 await writeFile(join(work,'app.txt'),'local');git(work,'commit','-am','local');
 const store=new c.Store(work,'conflict');
 await assert.rejects(()=>finishGate(store,{claims:['done']}),/app\.txt/);
 const s=await store.load();
 assert.equal(s.status,'active','The run stays active after the conflict refusal');
 const conflicts=s.events.filter(e=>e.type==='base-conflict');
 assert.equal(conflicts.length,1,'Exactly one base-conflict event');
 assert.deepEqual((conflicts[0].detail as any).files,['app.txt']);
});

test('finishGate accepts a checkout that merges cleanly with the fetched origin default branch',{timeout:60000},async t=>{
 const {root,work}=await staleClone(t);
 git(work,'pull','--ff-only','origin','main');
 await main(['start',work,'clean',await startInput(root,'clean')]);
 const store=new c.Store(work,'clean');
 await writeFile(join(work,'app.txt'),'local');git(work,'commit','-am','local');git(work,'push','origin','HEAD:main');
 await deliverOnly(store,work);
 await finishGate(store,{claims:['done']});
 const s=await store.load();
 assert.equal(s.status,'complete');
 assert.ok(s.events.some(e=>e.type==='base-verified'&&(e.detail as any).stage==='finish'),'A base-verified event records the finish check');
});
