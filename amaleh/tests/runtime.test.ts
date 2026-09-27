import {fixtureClaim,clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, readdir, rm, lstat, symlink, unlink, realpath } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from '../scripts/core.ts';
import { choiceAnswer, hostDecision } from '../scripts/adapters.ts';
import { install, uninstall, statusHtml } from '../scripts/cli.ts';

async function fixture(t:any){const dir=await mkdtemp(join(tmpdir(),'amaleh-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'app.txt'),'original');const store=await c.start(dir,{shape:clearCut,id:'run',host:{kind:'codex',model:'gpt-6-astra'},intent:'Correct charge amount',criteria:['Correct amount charged']});return {dir,store};}
const task=(id:string,deps:string[]=[])=>({id,title:id,goal:'Correct observable behavior',phase:'checkout',deps,resources:[id],criteria:['correct result'],kind:'code' as const,checks:[{id:'test',command:process.execPath,args:['-e',"try{const c=require('fs').readFileSync(require('path').join(process.cwd(),'app.txt'),'utf8');process.exit(c.includes('original')?1:0)}catch{process.exit(1)}"],role:'probe' as const}]} as c.Task);
async function syntheticCoverage(store:c.Store,id:string){const state=await store.load();return c.reviewObligations(state,c.taskOf(state,id)).map(o=>({id:o.id,status:'covered' as const,evidence:'Synthetic protocol fixture only; not a real model review'}));}
async function deliver(store:c.Store,dir:string,id='a') {await fixtureClaim(store,id,{workspace:dir,model:'deepseek/flash'});writeFileSync(join(dir,'app.txt'),'corrected');await c.result(store,id,{changed:'app.txt'});await c.check(store,id,'test');await c.review(store,id,{coverage:await syntheticCoverage(store,id),model:'z-ai/glm-flash',findings:[],fingerprint:await c.fingerprint(dir),report:'Spec and Standards inspected actual implementation'});await c.accept(store,id);await c.integrated(store,id,'Inspected integrated behavior and actual diff');}

test('small work completes with current checks and independent review',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[{id:'all',command:process.execPath,args:['-e','process.exit(0)']}]});assert.equal((await c.next(store)).action,'route-dispatch');await deliver(store,dir);await c.check(store,undefined,'all');await c.finish(store,['Checked exact expected amount']);assert.equal((await c.next(store)).action,'done');await assert.rejects(()=>fixtureClaim(store,'a',{workspace:dir,model:'x'}),/is complete and cannot change\. Start a new run with "continues":"run"/);});
test('rejects invalid graph identities and dependencies',async t=>{const {store}=await fixture(t);for(const tasks of [[task('a'),task('a')],[task('a',['missing'])],[task('a',['b']),task('b',['a'])]])await assert.rejects(()=>c.plan(store,{tasks,integrationChecks:[]}));});
test('failed or stale checks cannot be accepted',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await c.result(store,'a',{});await c.review(store,'a',{coverage:await syntheticCoverage(store,'a'),model:'glm',fingerprint:await c.fingerprint(dir),findings:[],report:'inspected'});await assert.rejects(()=>c.accept(store,'a'),/checks/);await c.check(store,'a','test');await writeFile(join(dir,'app.txt'),'changed');await assert.rejects(()=>c.accept(store,'a'),/stale/);});
test('review must come from different family and refer to actual current content',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await c.result(store,'a',{});await assert.rejects(()=>c.review(store,'a',{model:'another/deepseek',fingerprint:awaitableFake,findings:[],report:'inspected'}),/another model family/);await assert.rejects(()=>c.review(store,'a',{model:'glm',fingerprint:'stale',findings:[],report:'inspected'}),/stale/);});
const awaitableFake='unused';
test('repair escalation survives restart and blocks third Flash repair',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});for(let cycle=1;cycle<=4;cycle++){const depth=c.taskOf(await store.load(),'a').depth;await fixtureClaim(store,'a',{workspace:dir,model:depth==='deep'?'moonshotai/kimi-k3':depth==='host'?'gpt-6-astra':'deepseek/flash'});await c.result(store,'a',{});await c.review(store,'a',{coverage:await syntheticCoverage(store,'a'),model:'z-ai/glm-flash',fingerprint:await c.fingerprint(dir),report:'wrong charge remains',findings:[{id:'wrong-charge',lens:'money',location:'app.txt',scenario:'checkout charges 11 instead of 10',evidence:'observed expected-versus-actual',consequence:'overcharge',blocking:true}]});await c.repair(store,'a');if(cycle===3){assert.equal(c.taskOf(await store.load(),'a').depth,'deep');await assert.rejects(()=>fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'}),/Kimi/);}await c.resume(new c.Store(dir,'run'));}assert.equal(c.taskOf(await store.load(),'a').depth,'host');assert.equal(c.taskOf(await store.load(),'a').cycles,4);});
test('independent task unlocks dependent without global wave barrier',async t=>{const {dir,store}=await fixture(t);const other=join(dir,'.amaleh','isolated');await mkdir(other,{recursive:true});await c.plan(store,{tasks:[task('short'),task('long'),task('dependent',['short'])],integrationChecks:[]});await fixtureClaim(store,'long',{workspace:other,model:'deepseek/flash'});await deliver(store,dir,'short');const next=await c.next(store);assert.equal(next.action,'route-dispatch');assert.ok((next as any).tasks.some((t:any)=>t.id==='dependent'));});
test('same workspace workers cannot race',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a'),task('b')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await assert.rejects(()=>fixtureClaim(store,'b',{workspace:dir,model:'glm'}),/Conflicting/);});
test('resume preserves live owners and blocks abandoned effects',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash',pid:process.pid});await c.resume(store);assert.equal(c.taskOf(await store.load(),'a').status,'running');await store.transaction(s=>{c.taskOf(s,'a').owner!.pid=2147483647;});await c.resume(store);assert.equal(c.taskOf(await store.load(),'a').status,'running','a live coordinator still owns the outcome of its dead worker');await store.transaction(s=>{c.taskOf(s,'a').owner!.coordinatorPid=2147483646;});assert.equal((await c.next(store)).action,'resume');await c.resume(store);assert.equal(c.taskOf(await store.load(),'a').status,'blocked');assert.match(c.taskOf(await store.load(),'a').blocked!,/reconcile/);});
test('claim support remains pending after uncertain Jev judgment',async t=>{const {store}=await fixture(t);const answer=choiceAnswer({model:'typesafe/jev-1.13',answers:{selection:{type:'choice',choice:'yes',confidence:.4,probabilities:{yes:.55,no:.45}}}},{yes:'Supported',no:'Unsupported'});assert.equal(answer.choice,undefined);await store.transaction(s=>{s.decisions.push({id:'support',question:'Supported?',criteria:{yes:'supported',no:'unsupported'},state:{},revision:s.revision});});assert.equal((await c.next(store)).action,'host-decision');await hostDecision(store,'support','no','Missing evidence');assert.equal((await c.next(store)).action,'discover-specify-plan');assert.throws(()=>choiceAnswer({answers:{selection:{type:'choice',choice:'invented',confidence:1}}},{yes:'yes',no:'no'}));});
test('artifacts survive compaction and HTML escapes untrusted text',async t=>{const {store}=await fixture(t);const artifact=await store.artifact({evidence:'retain <script>alert(1)</script>'});assert.match(await store.readArtifact(artifact),/retain/);await store.transaction(s=>{s.intent='<script>alert(1)</script>';});const {path}=await statusHtml(store);assert.ok((await readFile(path,'utf8')).includes('&lt;script&gt;'));});
test('installer is rerunnable and refuses conflicting destinations',async t=>{const {dir}=await fixture(t);const old=process.env.CODEX_HOME;delete process.env.CODEX_HOME;try{await install(dir);const again=await install(dir);assert.ok(again.every(r=>r.status==='already linked'));const other=join(dir,'other');await mkdir(join(other,'.codex','skills','amaleh'),{recursive:true});await assert.rejects(()=>install(other),/Conflicting/);}finally{if(old)process.env.CODEX_HOME=old;}});
const skillTargets=(home:string)=>[join(home,'.codex','skills','amaleh'),join(home,'.claude','skills','amaleh')];
const canonicalSkill=()=>realpath(join(dirname(fileURLToPath(import.meta.url)),'..'));
const exists=async(path:string)=>{try{await lstat(path);return true;}catch{return false;}};
async function withoutCodexHome(run:()=>Promise<void>){const old=process.env.CODEX_HOME;delete process.env.CODEX_HOME;try{await run();}finally{if(old)process.env.CODEX_HOME=old;}}
test('install then uninstall round trip is rerunnable and relinks after removal',async t=>{
 const {dir}=await fixture(t);
 await withoutCodexHome(async()=>{
  const targets=skillTargets(dir),source=await canonicalSkill(),files=(await readdir(source)).sort().join(',');
  assert.ok((await install(dir)).every(r=>r.status==='linked'));
  const removed=await uninstall(dir);
  assert.deepEqual(removed.map(r=>r.status),['removed','removed']);
  for(const target of targets)assert.equal(await exists(target),false);
  const again=await uninstall(dir);
  assert.ok(again.every(r=>r.status==='not installed'));
  assert.ok((await install(dir)).every(r=>r.status==='linked'));
  for(const target of targets)assert.equal(await realpath(target),source);
  assert.ok((await uninstall(dir)).every(r=>r.status==='removed'));
  assert.equal((await readdir(source)).sort().join(','),files);
 });
});
test('uninstall refuses a real directory target and removes nothing from either target',async t=>{
 const {dir}=await fixture(t);
 await withoutCodexHome(async()=>{
  const [codex,claude]=skillTargets(dir),source=await canonicalSkill();
  await install(dir);
  await unlink(claude);
  await mkdir(claude,{recursive:true});
  await writeFile(join(claude,'SKILL.md'),'user copy');
  await assert.rejects(()=>uninstall(dir),/Conflicting skill target: .*amaleh/);
  assert.equal(await readFile(join(claude,'SKILL.md'),'utf8'),'user copy');
  assert.equal(await exists(codex),true);
  assert.equal(await realpath(codex),source);
 });
});
test('uninstall refuses a link to another directory and preserves it',async t=>{
 const {dir}=await fixture(t);
 await withoutCodexHome(async()=>{
  const [codex,claude]=skillTargets(dir),elsewhere=join(dir,'elsewhere');
  await install(dir);
  await unlink(claude);
  await mkdir(elsewhere,{recursive:true});
  await writeFile(join(elsewhere,'SKILL.md'),'other checkout');
  await symlink(elsewhere,claude,process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>uninstall(dir),/Conflicting skill target: .*amaleh/);
  assert.equal(await realpath(claude),await realpath(elsewhere));
  assert.equal(await readFile(join(elsewhere,'SKILL.md'),'utf8'),'other checkout');
  assert.equal(await exists(codex),true);
 });
});

test('next advances checks, review and acceptance without repeated review',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});writeFileSync(join(dir,'app.txt'),'corrected');await c.result(store,'a',{});assert.equal((await c.next(store)).action,'check');await c.check(store,'a','test');assert.equal((await c.next(store)).action,'review');await c.review(store,'a',{coverage:await syntheticCoverage(store,'a'),model:'glm',fingerprint:await c.fingerprint(dir),findings:[],report:'Spec and Standards checked'});assert.equal((await c.next(store)).action,'accept');});
test('concurrent checkpoint commits serialize without losing events',async t=>{const {store}=await fixture(t);await Promise.all(Array.from({length:6},(_,i)=>store.transaction(async s=>{await new Promise(r=>setTimeout(r,10));c.event(s,'concurrent',i);})));assert.equal((await store.load()).events.filter(e=>e.type==='concurrent').length,6);});
test('check cannot credit a tree changed during execution',async t=>{const {dir,store}=await fixture(t);const a=task('a');a.checks=[{id:'test',command:process.execPath,args:['-e',"require('fs').writeFileSync('app.txt','bad amount')"],role:'probe' as const}];await c.plan(store,{tasks:[a],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await c.result(store,'a',{});assert.equal((await c.check(store,'a','test')).changed,true);await c.review(store,'a',{coverage:await syntheticCoverage(store,'a'),model:'glm',fingerprint:await c.fingerprint(dir),findings:[],report:'review'});await assert.rejects(()=>c.accept(store,'a'),/stale/);});
test('invalidation carries escalation and invalidates downstream acceptance',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a'),task('b',['a'])],integrationChecks:[]});await deliver(store,dir,'a');await deliver(store,dir,'b');await store.transaction(s=>c.invalidateTree(s,'a','upstream contract changed'));let s=await store.load();assert.equal(c.taskOf(s,'b').integrated,undefined);assert.equal(c.taskOf(s,'b').status,'review');assert.equal(c.taskOf(s,'b').cycles,0);assert.equal(c.taskOf(s,'a').cycles,1);await store.transaction(s=>c.invalidateTree(s,'a','another correction'));await store.transaction(s=>c.invalidateTree(s,'a','another correction'));s=await store.load();assert.equal(c.taskOf(s,'a').depth,'deep');await assert.rejects(()=>c.finish(store,['done']),/Incomplete tasks: a \(ready\), b \(review\)$/);});
test('integrated names the missing task worktree instead of failing on a raw directory error',async t=>{const {dir,store}=await fixture(t);const work=join(dir,'.amaleh','worktree');await mkdir(work,{recursive:true});await writeFile(join(work,'app.txt'),'original');await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:work,model:'deepseek/flash'});writeFileSync(join(work,'app.txt'),'corrected');await c.result(store,'a',{changed:'app.txt'});await c.check(store,'a','test');await c.review(store,'a',{coverage:await syntheticCoverage(store,'a'),model:'z-ai/glm-flash',findings:[],fingerprint:await c.fingerprint(work),report:'Synthetic fixture review'});await c.accept(store,'a');const accepted=c.taskOf(await store.load(),'a').workspace!;await rm(work,{recursive:true,force:true});await assert.rejects(()=>c.integrated(store,'a','Merged, then removed the worktree'),new RegExp(`Task a's workspace .* is gone \\(ENOENT\\)\\. .*record integrated before removing a task worktree`));assert.equal(accepted,c.taskOf(await store.load(),'a').workspace);await assert.rejects(()=>c.finish(store,['done']),/Incomplete tasks: a \(accepted, integrated not recorded\)/);});
test('unregistered final changes cannot slip through empty integration checks',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await deliver(store,dir);await writeFile(join(dir,'app.txt'),'bad amount');await assert.rejects(()=>c.finish(store,['done']),/changed after/);});

test('completed run resumes as done without mutation',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await deliver(store,dir);await c.finish(store,['amount checked']);const revision=(await store.load()).revision;assert.equal((await c.resume(store)).action,'done');assert.equal((await store.load()).revision,revision);});
test('resume invalidates obsolete downstream evidence',async t=>{const {dir,store}=await fixture(t);const a=join(dir,'.amaleh','a'),b=join(dir,'.amaleh','b');await mkdir(a,{recursive:true});await mkdir(b,{recursive:true});await writeFile(join(a,'amount'),'10');await c.plan(store,{tasks:[task('a'),task('b',['a'])],integrationChecks:[]});await deliver(store,a,'a');await deliver(store,b,'b');await writeFile(join(a,'amount'),'11');await c.resume(store);const state=await store.load();assert.equal(c.taskOf(state,'a').status,'ready');assert.equal(c.taskOf(state,'b').status,'review');assert.equal(c.taskOf(state,'b').integrated,undefined);});
test('cross-host resume retains history and allows actual new host escalation',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});await store.transaction(s=>{const t=c.taskOf(s,'a');t.depth='host';t.cycles=4;});await c.resume(store,{kind:'claude',model:'claude-fable'});await fixtureClaim(store,'a',{workspace:dir,model:'claude-fable'});const state=await store.load();assert.equal(state.host.model,'claude-fable');assert.equal(c.taskOf(state,'a').cycles,4);assert.ok(state.events.some(e=>e.type==='host-resumed'));});
test('contract amendment reopens descendants and retains repair ancestry without charging it',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a'),task('b',['a'])],integrationChecks:[]});await deliver(store,dir,'a');await deliver(store,dir,'b');await store.transaction(s=>{c.taskOf(s,'a').cycles=2;});await c.amend(store,{id:'a',reason:'New user-confirmed amount rule',task:{...task('a'),goal:'Apply the updated agreed amount rule'}});const s=await store.load();assert.equal(c.taskOf(s,'a').goal,'Apply the updated agreed amount rule');assert.equal(c.taskOf(s,'a').cycles,2);assert.equal(c.taskOf(s,'b').status,'review');assert.equal(c.taskOf(s,'b').cycles,0);await assert.rejects(()=>c.amend(store,{id:'a',reason:'invalid cycle',task:task('a',['b'])}),/cycle/);});
test('missing check executable records failure and opens repair instead of repeating checks forever',async t=>{const {dir,store}=await fixture(t);const a=task('a');a.checks=[{id:'missing',command:join(dir,'missing-executable'),args:[],role:'probe' as const}];await c.plan(store,{tasks:[a],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await c.result(store,'a',{});assert.equal((await c.check(store,'a','missing')).code,1);assert.equal((await c.next(store)).action,'repair-needed');await c.repair(store,'a');assert.equal(c.taskOf(await store.load(),'a').status,'repair');});
test('review focus preserves visibility of unrelated ready work',async t=>{const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a'),task('b')],integrationChecks:[]});await fixtureClaim(store,'a',{workspace:dir,model:'deepseek/flash'});await c.result(store,'a',{});const next=await c.next(store);assert.equal(next.action,'check');assert.ok(next.parallel?.ready.some(t=>t.id==='b'));});

test('missing review workspace exposes recovery and independent progress without losing evidence',async t=>{
 const {dir,store}=await fixture(t),workspace=join(dir,'.amaleh','missing-review');await mkdir(workspace);
 await c.plan(store,{tasks:[task('a'),task('independent')],integrationChecks:[]});
 await fixtureClaim(store,'a',{workspace,model:'deepseek/flash'});await c.result(store,'a',{evidence:'retain original'});
 await store.transaction(s=>{c.taskOf(s,'a').cycles=2;c.taskOf(s,'a').depth='flash';});
 const before=await store.load(),original=c.taskOf(before,'a').output!;
 await rm(workspace,{recursive:true});
 const status=await c.packet(store);assert.ok('next' in status);
 for(const next of [await c.next(store),status.next]){assert.equal(next.action,'reconcile-workspace');assert.ok(next.parallel?.ready.some(t=>t.id==='independent'));}
 assert.equal((await store.load()).revision,before.revision);
 const resumed=await c.resume(store);assert.equal(resumed.action,'route-dispatch');assert.ok(resumed.parallel?.ready.some(t=>t.id==='independent'));
 const state=await store.load();assert.equal(c.taskOf(state,'a').status,'blocked');assert.equal(c.taskOf(state,'a').cycles,2);assert.equal(c.taskOf(state,'a').output,original);assert.match(await store.readArtifact(original),/retain original/);
 await c.resume(store);assert.equal(c.taskOf(await store.load(),'a').cycles,2);assert.equal(c.taskOf(await store.load(),'a').depth,'flash');
});

test('missing accepted workspace blocks stale descendants but preserves live ownership',async t=>{
 const {dir,store}=await fixture(t),a=join(dir,'.amaleh','a'),b=join(dir,'.amaleh','b'),live=join(dir,'.amaleh','live');
 for(const path of [a,b,live])await mkdir(path);
 await c.plan(store,{tasks:[task('a'),task('b',['a']),task('live',['a']),task('independent')],integrationChecks:[]});
 await deliver(store,a,'a');await deliver(store,b,'b');await fixtureClaim(store,'live',{workspace:live,model:'deepseek/flash',pid:process.pid});
 const original=await store.load(),owner=c.taskOf(original,'live').owner,reviewArtifact=c.taskOf(original,'b').review!.artifact;
 await rm(a,{recursive:true});const resumed=await c.resume(store);assert.ok(resumed.parallel?.ready.some(t=>t.id==='independent'));
 const state=await store.load();for(const id of ['a','b']){assert.equal(c.taskOf(state,id).status,'blocked');assert.equal(c.taskOf(state,id).integrated,undefined);assert.equal(c.taskOf(state,id).cycles,0);}
 assert.equal(c.taskOf(state,'live').status,'running');assert.deepEqual(c.taskOf(state,'live').owner,owner);assert.match(await store.readArtifact(reviewArtifact),/inspected/);
 await c.result(store,'live',{});await c.check(store,'live','test');await c.review(store,'live',{model:'glm',fingerprint:await c.fingerprint(live),findings:[],report:'Synthetic review fixture'});
 await assert.rejects(()=>c.accept(store,'live'),/Unmet dependencies/);
 await assert.rejects(()=>c.finish(store,['incorrect stale completion']),/Incomplete/);
});

const host={kind:'codex',model:'gpt-6-astra'};
async function workspace(t:any){const dir=await mkdtemp(join(tmpdir(),'amaleh-lineage-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function wideFixture(t:any){const dir=await workspace(t);const store=await c.start(dir,{shape:clearCut,id:'wide',host,intent:'Build a ten page marketing website',criteria:['Ten pages exist','Navigation reaches every page','Copy is final','Styling is consistent']});return {dir,store};}
const wholeSite={id:'whole',title:'whole',goal:'Build the entire website',phase:'one',deps:[],resources:['*'],criteria:['pages render'],kind:'code' as const,checks:[],noProbe:'Visual layout task; no automated executable can verify visual output quality'};

test('a single task for many outcomes is rejected with the counts it saw',async t=>{
 const {store}=await wideFixture(t);
 await assert.rejects(()=>c.plan(store,{tasks:[wholeSite],integrationChecks:[]}),/Single task for 4 run outcomes and 1 task criteria/);
 const {store:narrow}=await fixture(t);
 await assert.rejects(()=>c.plan(narrow,{tasks:[{...task('a'),criteria:['renders','links','copy','styling']}],integrationChecks:[]}),/Single task for 1 run outcomes and 4 task criteria/);
});
test('a stated single chunk reason plans the whole feature and is recorded',async t=>{
 const {store}=await wideFixture(t);
 await c.plan(store,{tasks:[wholeSite],integrationChecks:[],singleChunk:'One HTML file; parallel workers would collide on every write'});
 const s=await store.load();assert.deepEqual(s.tasks.map(t=>t.id),['whole']);
 const recorded=s.events.find(e=>e.type==='single-chunk')!.detail as any;
 assert.match(recorded.reason,/collide on every write/);assert.equal(recorded.runCriteria,4);assert.equal(recorded.taskCriteria,1);
 await c.plan(store,{tasks:[wholeSite],integrationChecks:[]});
 assert.equal((await store.load()).events.filter(e=>e.type==='planned').length,2);
});
test('a blank single chunk reason is not an escape hatch',async t=>{const {store}=await wideFixture(t);for(const singleChunk of ['','   ','\n\t'])await assert.rejects(()=>c.plan(store,{tasks:[wholeSite],integrationChecks:[],singleChunk}),/Single task for 4 run outcomes/);});

test('continues inherits answered requirement decisions and no routing history',async t=>{
 const dir=await workspace(t);
 const first=await c.start(dir,{shape:clearCut,id:'first',host,intent:'Build the marketing website',criteria:['Pages render','Navigation reaches every page']});
 await first.transaction(s=>{s.decisions.push(
  {purpose:'requirement',id:'palette',question:'Which palette?',criteria:{warm:'Warm neutrals'},choice:'warm',reason:'Owner chose warm neutrals',state:{},revision:s.revision},
  {purpose:'requirement',id:'typeface',question:'Which typeface?',criteria:{serif:'Serif'},state:{},revision:s.revision},
  {id:'route',question:'Which worker?',criteria:{flash:'deepseek/flash'},choice:'flash',state:{routing:{scope:{taskId:'a'}}},revision:s.revision});});
 const second=await c.start(dir,{shape:clearCut,id:'second',continues:'first',host,intent:'Improve the marketing website',criteria:['Pages read better']});
 const s=await second.load();
 assert.deepEqual(s.decisions.map(d=>d.id),['palette']);
 assert.equal(s.decisions[0].source,'inherited:first');assert.equal(s.decisions[0].choice,'warm');assert.equal(s.decisions[0].reason,'Owner chose warm neutrals');
 assert.deepEqual(s.lineage,{continues:'first',inheritedCriteria:['Pages render','Navigation reaches every page'],inheritedDecisions:['palette']});
 assert.deepEqual(s.events.find(e=>e.type==='continues')!.detail,{continues:'first',inheritedCriteria:2,inheritedDecisions:1});
 assert.equal((await c.summarize(dir,'second')).continues,'first');
});
test('continues names the prior run it could not load',async t=>{const dir=await workspace(t);await assert.rejects(()=>c.start(dir,{shape:clearCut,id:'second',continues:'absent-run',host,intent:'Improve the marketing website',criteria:['Pages read better']}),/absent-run/);});

test('a near duplicate intent is refused and names the run to continue',async t=>{
 const dir=await workspace(t);
 await c.start(dir,{shape:clearCut,id:'first',host,intent:'Redesign the marketing website navigation and typography',criteria:['Navigation is clear']});
 await assert.rejects(()=>c.start(dir,{shape:clearCut,id:'second',host,intent:'Redesign marketing website typography and navigation again',criteria:['Navigation is clearer']}),/first.*continues/s);
});
test('an explicit unrelated reason admits a similar intent and records the match',async t=>{
 const dir=await workspace(t);
 await c.start(dir,{shape:clearCut,id:'first',host,intent:'Redesign the marketing website navigation and typography',criteria:['Navigation is clear']});
 const second=await c.start(dir,{shape:clearCut,id:'second',host,unrelated:'Different client brand sharing the same vocabulary',intent:'Redesign marketing website typography and navigation again',criteria:['Navigation is clearer']});
 const recorded=(await second.load()).events.find(e=>e.type==='unrelated-run')!.detail as any;
 assert.equal(recorded.matched,'first');assert.match(recorded.reason,/Different client brand/);assert.ok(recorded.score>=0.3);
});
test('a first run in an empty workspace is never treated as a duplicate',async t=>{const dir=await workspace(t);const store=await c.start(dir,{shape:clearCut,id:'only',host,intent:'Build a brand new website from nothing',criteria:['The website exists']});assert.equal((await store.load()).id,'only');});
test('an unreadable prior run does not block a new run',async t=>{
 const dir=await workspace(t);
 await c.start(dir,{shape:clearCut,id:'first',host,intent:'Redesign the marketing website navigation and typography',criteria:['Navigation is clear']});
 await writeFile(join(dir,'.amaleh','runs','first','revision-000000000.json'),'{ truncated');
 await mkdir(join(dir,'.amaleh','runs','empty'),{recursive:true});
 const store=await c.start(dir,{shape:clearCut,id:'second',host,intent:'Redesign marketing website typography and navigation again',criteria:['Navigation is clearer']});
 assert.equal((await store.load()).id,'second');
});
test('summarize reports the current run shape for a coordinator',async t=>{
 const {dir,store}=await fixture(t);await c.plan(store,{tasks:[task('a')],integrationChecks:[]});
 assert.deepEqual(await c.summarize(dir,'run'),{id:'run',status:'active',intent:'Correct charge amount',criteria:['Correct amount charged'],tasks:1,revision:1,continues:undefined,acceptance:undefined});
});
