import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { delegate } from '../scripts/delegate.ts';
import { fixtureClaim, clearCut } from './execution-fixture.ts';

const task=(id:string,deps:string[]=[]):c.TaskInput=>({
 id,title:id,goal:'Correct observable behavior',phase:'one',deps,resources:[id],criteria:['correct result'],kind:'code',
 checks:[{id:'test',command:process.execPath,args:['-e','process.exit(0)'],role:'guard'}],
 noProbe:'Test fixture; reopen accounting is asserted by the test, not by an executable probe',
});
const git=(cwd:string,args:string[])=>execFileSync('git',args,{cwd,stdio:['ignore','pipe','pipe']}).toString();
const coverage=(s:c.Run,id:string)=>c.reviewObligations(s,c.taskOf(s,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic protocol fixture only'}));
async function review(store:c.Store,dir:string,id:string){await c.review(store,id,{coverage:coverage(await store.load(),id),model:'z-ai/glm-flash',findings:[],fingerprint:await c.fingerprint(dir),report:'Synthetic fixture review; not a model judgment'});}
async function deliver(store:c.Store,dir:string,id:string){
 await fixtureClaim(store,id,{workspace:dir,model:'deepseek/flash'});
 await writeFile(join(dir,id+'.txt'),'delivered '+Date.now());
 await c.result(store,id,{changed:id+'.txt'});
 await c.check(store,id,'test');
 await review(store,dir,id);
 await c.accept(store,id);
 await c.integrated(store,id,'Synthetic fixture integration');
}
async function delivered(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-dependent-reopen-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await c.start(dir,{shape:clearCut,id:'dependents',host:{kind:'codex',model:'gpt-6-astra'},intent:'Reopen only the defective chunk',criteria:['a dependent is not charged for its upstream defect']});
 await c.plan(store,{tasks:[task('up'),task('down',['up'])],integrationChecks:[]});
 await deliver(store,dir,'up');
 await deliver(store,dir,'down');
 return {dir,store};
}

test('a defect reopen charges only the reopened task; its dependent keeps its output for verification',async t=>{
 const {store}=await delivered(t);
 const output=c.taskOf(await store.load(),'down').output;
 await c.invalidate(store,{id:'up',reason:'The upstream output is wrong',noProbe:'Visual defect with no executable measure in this fixture'});
 const s=await store.load(),up=c.taskOf(s,'up'),down=c.taskOf(s,'down');
 assert.equal(up.cycles,1);
 assert.equal(up.status,'ready');
 assert.equal(down.cycles,0,'the dependent has no defect of its own');
 assert.equal(down.status,'review');
 assert.equal(down.output,output,'the delivered output is kept');
 assert.equal(down.integrated,undefined);
 assert.deepEqual((s.events.at(-2)!.detail as {reverified:string[]}).reverified,['down']);
 assert.equal((await c.next(store)).action,'route-dispatch','the upstream repair comes first, not the waiting dependent');
});

test('a dependent waiting on its upstream is not verified early, and is verified with no worker run once the upstream is back',async t=>{
 const {dir,store}=await delivered(t);
 await c.invalidate(store,{id:'up',reason:'The upstream output is wrong',noProbe:'Visual defect with no executable measure in this fixture'});
 let workers=0;
 const noWorker=(async()=>{workers++;throw new Error('a kept output must not start a worker');}) as any;
 const reviewer=(async(s:c.Store,id:string)=>{await review(s,dir,id);return {findings:[]};}) as any;
 const early=await delegate(store,'down',{},{runWorker:noWorker,runReviewer:reviewer});
 assert.equal(early.outcome,'route-pending');
 assert.deepEqual((early.route as {tasks:string[]}).tasks,['up']);
 assert.equal(c.taskOf(await store.load(),'down').status,'review');
 await deliver(store,dir,'up');
 const verified=await delegate(store,'down',{},{runWorker:noWorker,runReviewer:reviewer});
 assert.equal(verified.outcome,'accepted',String(verified.reason??''));
 assert.equal(workers,0);
 assert.ok(verified.trail.some(s=>s.stage==='resume-verification'));
 assert.equal(c.taskOf(await store.load(),'down').cycles,0);
});

test('a dependent whose own last attempt failed is sent back for a repair and charged for it',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-dependent-failed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await c.start(dir,{shape:clearCut,id:'failed',host:{kind:'codex',model:'gpt-6-astra'},intent:'Reopen only the defective chunk',criteria:['a failing dependent is not verified as it stands']});
 const failing={...task('down',['up']),checks:[{id:'test',command:process.execPath,args:['-e','process.exit(1)'],role:'guard' as const}]};
 await c.plan(store,{tasks:[task('up'),failing],integrationChecks:[]});
 await deliver(store,dir,'up');
 await fixtureClaim(store,'down',{workspace:dir,model:'deepseek/flash'});
 await c.result(store,'down',{changed:'down.txt'});
 await c.check(store,'down','test');
 await c.invalidate(store,{id:'up',reason:'The upstream output is wrong',noProbe:'Visual defect with no executable measure in this fixture'});
 const s=await store.load(),down=c.taskOf(s,'down');
 assert.equal(down.status,'ready','its failing output must be repaired, not verified again as it stands');
 assert.equal(down.cycles,1);
 assert.deepEqual((s.events.findLast(e=>e.type==='invalidated')!.detail as {reverified:string[]}).reverified,[]);
});

test('a kept dependent whose checkout lacks the integrated upstream commit is not verified until it is refreshed',{timeout:60000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'amaleh-dependent-git-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const main=join(root,'main'),down=join(root,'down');
 await mkdir(main);
 git(main,['init']);git(main,['config','user.email','fixture@amaleh.test']);git(main,['config','user.name','fixture']);
 await writeFile(join(main,'base.txt'),'base');git(main,['add','-A']);git(main,['commit','-m','base','--no-gpg-sign']);
 git(main,['worktree','add','-b','down',down]);
 const store=await c.start(main,{shape:clearCut,id:'refresh',host:{kind:'codex',model:'gpt-6-astra'},intent:'Verify a kept dependent on the new upstream',criteria:['a stale dependent checkout is refreshed first']});
 await c.plan(store,{tasks:[{...task('up'),resources:['up.txt']},{...task('down',['up']),resources:['down.txt']}],integrationChecks:[]});
 await deliver(store,main,'up');
 git(main,['add','-A']);git(main,['commit','-m','up','--no-gpg-sign']);
 git(down,['merge','--no-edit',git(main,['rev-parse','--abbrev-ref','HEAD']).trim()]);
 await deliver(store,down,'down');
 await c.invalidate(store,{id:'up',reason:'The upstream output is wrong',noProbe:'Visual defect with no executable measure in this fixture'});
 await deliver(store,main,'up');
 git(main,['add','-A']);git(main,['commit','-m','up repaired','--no-gpg-sign']);
 let workers=0;
 const noWorker=(async()=>{workers++;throw new Error('a kept output must not start a worker');}) as any;
 const reviewer=(async(s:c.Store,id:string)=>{await review(s,down,id);return {findings:[]};}) as any;
 const stale=await delegate(store,'down',{},{runWorker:noWorker,runReviewer:reviewer});
 assert.equal(stale.outcome,'escalated');
 assert.equal(stale.stage,'refresh-checkout');
 assert.match(String(stale.reason),/does not contain the run's integrated commit .* Merge the run branch into that checkout/);
 assert.equal((await c.next(store)).action,'refresh-checkout');
 git(down,['merge','--no-edit',git(main,['rev-parse','--abbrev-ref','HEAD']).trim()]);
 const verified=await delegate(store,'down',{},{runWorker:noWorker,runReviewer:reviewer});
 assert.equal(verified.outcome,'accepted',String(verified.reason??''));
 assert.equal(workers,0);
});

test('a dependent that never produced output goes back to ready',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-dependent-fresh-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await c.start(dir,{shape:clearCut,id:'fresh',host:{kind:'codex',model:'gpt-6-astra'},intent:'Reopen only the defective chunk',criteria:['an unstarted dependent stays ready']});
 await c.plan(store,{tasks:[task('up'),task('down',['up'])],integrationChecks:[]});
 await deliver(store,dir,'up');
 await c.invalidate(store,{id:'up',reason:'The upstream output is wrong',noProbe:'Visual defect with no executable measure in this fixture'});
 const down=c.taskOf(await store.load(),'down');
 assert.equal(down.status,'ready');
 assert.equal(down.cycles,0);
});
