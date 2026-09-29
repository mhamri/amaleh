import {clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';

test('worker context retains global constraints and dependency evidence without unrelated routing or global next',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-context-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await c.start(dir,{shape:clearCut,id:'fixture',host:{kind:'codex',model:'actual-test-host'},intent:'Synthetic context test',criteria:['Keep relevant evidence'],constraints:['Never change currency']});
 const task=(id:string,deps:string[]=[])=>({id,title:id,goal:id,phase:'one',deps,resources:[id],criteria:['fixture'],checks:[],kind:'research' as const});
 await c.plan(store,{tasks:[task('ancestor'),task('dep',['ancestor']),task('focus',['dep']),task('unrelated')],integrationChecks:[]});
 await store.transaction(s=>{for(const id of ['ancestor','dep','focus','unrelated','global'])s.decisions.push({id,question:id,criteria:{yes:'fixture answer'},choice:'yes',state:id==='global'?{}:{routing:{scope:{taskId:id}}},revision:s.revision});s.tasks[0].output='ancestor-artifact';});
 const packet=await c.packet(store,'focus');assert.deepEqual(packet.constraints,['Never change currency']);assert.deepEqual(packet.decisions.map(d=>d.id),['ancestor','dep','focus','global']);assert.ok(!('next' in packet));assert.ok(!('phaseStatus' in packet));
 assert.ok('dependencies' in packet);assert.deepEqual(packet.dependencies!.map(d=>d.id),['ancestor','dep']);assert.equal(packet.dependencies![0].output,'ancestor-artifact');assert.ok(packet.durableState?.endsWith('.json'));
 assert.ok('runOutcomes' in packet&&!('criteria' in packet));assert.deepEqual(packet.otherTasks.map(o=>[o.id,o.resources]),[['ancestor',['ancestor']],['dep',['dep']],['unrelated',['unrelated']]]);
 const host=await c.packet(store);assert.equal(host.decisions.length,5);assert.ok('next' in host);assert.deepEqual('criteria' in host&&host.criteria,['Keep relevant evidence']);
});


test('review packet supplies factual contracts and navigable evidence without author rationale',async t=>{
 const {reviewPacket}=await import('../scripts/adapters.ts');
 const dir=await mkdtemp(join(tmpdir(),'amaleh-review-context-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await c.start(dir,{shape:clearCut,id:'fixture',host:{kind:'codex',model:'host'},intent:'Preserve charge',criteria:['Exact charge'],constraints:['No currency changes']});
 await c.plan(store,{tasks:[{id:'a',title:'a',goal:'Fix total',phase:'one',deps:[],resources:['total'],criteria:['correct total'],checks:[{id:'total',command:process.execPath,args:['-e','process.exit(0)'],role:'probe' as const}],kind:'code'}],integrationChecks:[]});
 await store.transaction(s=>{s.tasks[0].output='AUTHOR_VERDICT';s.decisions.push({purpose:'requirement',id:'requirement',question:'Currency?',criteria:{usd:'USD'},choice:'usd',state:{},revision:s.revision,reason:'AUTHOR_RATIONALE',artifact:'PRIVATE_RATIONALE'},{id:'verdict',question:'Support completion?',criteria:{yes:'PRIOR_VERDICT'},choice:'yes',state:{},revision:s.revision});});
 const packet=await reviewPacket(store,'a');const text=JSON.stringify(packet);
 assert.deepEqual(packet.outcomes,['Exact charge']);assert.deepEqual(packet.constraints,['No currency changes']);assert.equal(packet.decisions[0].answer,'USD');assert.ok(packet.artifactDirectory.endsWith('artifacts'));assert.equal(packet.checks[0].command.id,'total');assert.ok(packet.obligations.some(o=>o.id==='lifecycle'));
 for(const forbidden of ['AUTHOR_VERDICT','AUTHOR_RATIONALE','PRIVATE_RATIONALE','PRIOR_VERDICT'])assert.ok(!text.includes(forbidden));
 assert.match(packet.inspection.probes,/cannot execute/);
});
