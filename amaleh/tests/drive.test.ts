import {fixtureClaim,clearCut,jevGate} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {dirname,join} from 'node:path';
import * as c from '../scripts/core.ts';
import {drive} from '../scripts/drive.ts';
import {waitForDrive} from '../scripts/delegate.ts';
import {main} from '../scripts/cli.ts';
import {ensureWorktreeFolder,recordWorktreeFolder} from '../scripts/worktrees.ts';

const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const blocking=[{id:'wrong',lens:'Spec',location:'src/b.txt',scenario:'the file holds the wrong text',evidence:'read the file',consequence:'wrong output',blocking:true}];
const task=(id:string,deps:string[]=[])=>({id,title:`Write ${id}`,goal:`Write src/${id}.txt`,phase:'code',deps,resources:[`src/${id}.txt`],criteria:[`src/${id}.txt exists`],kind:'code' as const,checks:[],noProbe:'Test fixture; the drive flow is asserted by the test'});

async function fixture(t:any,tasks:ReturnType<typeof task>[]){
 const root=await mkdtemp(join(tmpdir(),'amaleh-drive-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const remote=join(root,'origin.git'),seed=join(root,'seed'),work=join(root,'work');
 git(root,'init','-q','--bare','-b','main',remote);
 mkdirSync(seed);git(seed,'init','-q','-b','main');git(seed,'config','user.name','Fixture');git(seed,'config','user.email','fixture@example.invalid');
 mkdirSync(join(seed,'src'));writeFileSync(join(seed,'src','shared.txt'),'seed\n');
 git(seed,'add','.');git(seed,'commit','-q','-m','seed');git(seed,'remote','add','origin',remote);git(seed,'push','-q','origin','main');
 git(root,'clone','-q',remote,work);git(work,'config','user.name','Fixture');git(work,'config','user.email','fixture@example.invalid');
 git(work,'switch','-q','-c','run-branch');
 const workspace=await realpath(work),folder=await ensureWorktreeFolder(workspace);
 const store=await c.start(workspace,{id:'drive',shape:clearCut,host:{kind:'codex',model:'fixture-host'},intent:'Drive the run without the main model',criteria:['Every file is written']});
 await recordWorktreeFolder(store,folder);
 if(tasks.length)await c.plan(store,{tasks,integrationChecks:[]});
 return {workspace,store};
}
const write=(path:string,content:string)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);};
const worker=(seen:Record<string,string[]>={})=>async(store:any,id:string,input:any)=>{
 seen[id]=['a','b','c'].filter(other=>existsSync(join(input.workspace,'src',`${other}.txt`)));
 await fixtureClaim(store,id,{workspace:input.workspace,model:'deepseek/flash'});
 write(join(input.workspace,'src',`${id}.txt`),`${id} ${Date.now()}\n`);
 await c.result(store,id,{changed:`src/${id}.txt`});
 return {artifact:c.taskOf(await store.load(),id).output};
};
const reviewer=(script:Record<string,unknown[]>={},before?:(id:string)=>void)=>async(store:any,id:string)=>{
 before?.(id);
 const state=await store.load(),t=c.taskOf(state,id),findings=(script[id]??[]) as c.Finding[];
 await c.review(store,id,{model:'z-ai/glm-flash',fingerprint:await c.fingerprint(t.workspace!),findings,report:'Synthetic fixture review',coverage:c.reviewObligations(state,t).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic protocol fixture only'}))});
 return {findings};
};

test('drive creates the worktrees, runs every chunk, merges each accepted chunk and starts its dependents',{timeout:180000},async t=>{
 const {workspace,store}=await fixture(t,[task('a'),task('b',['a']),task('c')]);
 const seen:Record<string,string[]>={};
 const out=await drive(store,{},{runWorker:worker(seen) as any,runReviewer:reviewer() as any,fetcher:jevGate()});
 assert.equal(out.outcome,'ready-to-verify');
 assert.deepEqual(out.handedBack,[]);
 assert.deepEqual([...out.integrated].sort(),['a','b','c']);
 assert.equal(out.next.action,'verify-feature');
 for(const id of ['a','b','c'])assert.ok(existsSync(join(workspace,'src',`${id}.txt`)),`src/${id}.txt reached the run checkout`);
 assert.ok(seen.b.includes('a'),'the dependent chunk starts from a checkout that holds its merged dependency');
 assert.ok(!seen.a.includes('b')&&!seen.c.includes('b'),'the dependent chunk waits for its dependency');
 assert.equal(git(workspace,'status','--porcelain'),'','the run checkout is clean after the merges');
 assert.match(git(workspace,'log','--format=%s','amaleh/drive/a','-1'),/^Write a$/,'the task commit carries the task title');
 const events=(await store.load()).events;
 assert.equal(events.filter(e=>e.type==='integrated').length,3);
 assert.ok(events.some(e=>e.type==='drive-finished'));
});

test('drive hands a merge conflict back and leaves the run checkout as it was',{timeout:180000},async t=>{
 const {workspace,store}=await fixture(t,[task('a')]);
 const collide=()=>{write(join(workspace,'src','a.txt'),'written by someone else\n');git(workspace,'add','.');git(workspace,'commit','-q','-m','collide');};
 const out=await drive(store,{},{runWorker:worker() as any,runReviewer:reviewer({},collide) as any,fetcher:jevGate()});
 assert.equal(out.outcome,'host-needed');
 assert.deepEqual(out.handedBack.map((h:any)=>[h.task,h.outcome,h.stage,h.files]),[['a','integration-needed','merge-conflict',['src/a.txt']]]);
 assert.equal(readFileSync(join(workspace,'src','a.txt'),'utf8').replace(/\r/g,''),'written by someone else\n');
 assert.equal(git(workspace,'status','--porcelain'),'','the aborted merge leaves no conflict markers behind');
 assert.equal(c.taskOf(await store.load(),'a').integrated,undefined);
 assert.equal(out.next.action,'integrate');
});

test('wait until drive returns the report of a finished drive, and a second live drive is refused',{timeout:180000},async t=>{
 const {store}=await fixture(t,[task('a')]);
 const cursor=(await store.load()).events.length;
 let second:unknown;
 const refuseSecond=async()=>{second=await drive(store,{},{}).catch(e=>(e as Error).message);};
 const slowReviewer=async(s:any,id:string)=>{await refuseSecond();return reviewer()(s,id);};
 assert.equal((await waitForDrive(store,{after:cursor,timeoutMs:0})).outcome,'idle');
 const out=await drive(store,{},{runWorker:worker() as any,runReviewer:slowReviewer as any,fetcher:jevGate()});
 assert.match(String(second),/already has a live drive/);
 const waited=await waitForDrive(store,{after:cursor,timeoutMs:0});
 assert.equal(waited.outcome,'finished');
 assert.deepEqual([waited.drive.outcome,waited.drive.integrated],[out.outcome,['a']]);
 assert.equal(waited.next.action,'verify-feature');
});

test('a drive whose process died is reported as interrupted and closed by resume',{timeout:180000},async t=>{
 const {store}=await fixture(t,[task('a')]);
 const cursor=(await store.load()).events.length;
 const dead=spawnSync(process.execPath,['-e','0']).pid;
 await store.transaction(s=>c.event(s,'drive-started',{pid:dead,host:hostname()}));
 assert.equal((await waitForDrive(store,{after:cursor,timeoutMs:0})).outcome,'interrupted');
 await c.resume(store,{kind:'codex',model:'fixture-host'});
 assert.deepEqual((await store.load()).events.findLast(e=>e.type==='drive-finished')?.detail,{outcome:'interrupted'});
 const out=await drive(store,{},{runWorker:worker() as any,runReviewer:reviewer() as any,fetcher:jevGate()});
 assert.equal(out.outcome,'ready-to-verify');
});

test('the drive command starts a detached process and returns a cursor at once',{timeout:180000},async t=>{
 const {workspace,store}=await fixture(t,[]);
 const launched=await main(['drive',workspace,'drive']) as {launched:boolean;cursor:number;pid:number};
 assert.equal(launched.launched,true);
 assert.notEqual(launched.pid,process.pid);
 const inputFile=join(workspace,'..','wait.json');
 writeFileSync(inputFile,JSON.stringify({after:launched.cursor,until:'drive',timeoutMs:60000}));
 const waited=await main(['wait',workspace,'drive',inputFile]) as Awaited<ReturnType<typeof waitForDrive>>;
 assert.equal(waited.outcome,'finished');
 assert.deepEqual([waited.drive.outcome,waited.drive.integrated,waited.drive.handedBack],['host-needed',[],[]],'a run with no planned task has nothing to drive');
});

test('drive hands an escalated chunk back and still finishes the chunks beside it',{timeout:180000},async t=>{
 const {store}=await fixture(t,[task('a'),task('b')]);
 await store.transaction(s=>{s.config.flashRepairCycles=0;s.config.deepRepairCycles=0;});
 const out=await drive(store,{},{runWorker:worker() as any,runReviewer:reviewer({b:blocking}) as any,fetcher:jevGate()});
 assert.equal(out.outcome,'host-needed');
 assert.deepEqual(out.integrated,['a']);
 assert.deepEqual(out.handedBack.map((h:any)=>[h.task,h.outcome,h.stage]),[['b','escalated','repair-exhausted']]);
 assert.equal((out.handedBack[0] as any).trail,undefined,'the hand-back carries the outcome, not the step-by-step trail');
});
