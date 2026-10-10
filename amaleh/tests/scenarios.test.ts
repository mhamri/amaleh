import {clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { screenshot, screenshotOptions } from '../scripts/screenshot.ts';
import { loadScenario, modelUse, prepare, scenarioIds, scenariosDir } from '../scripts/scenarios.ts';
import { decodePng } from '../scripts/png.ts';
import { taskDiff } from '../scripts/adapters.ts';
import { inScope } from '../scripts/resources.ts';
import { execFileSync } from 'node:child_process';

async function temp(t:any,prefix:string){const dir=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('screenshot options come from the render check environment unless a flag overrides them',()=>{
 const env={AMALEH_RENDER:'C:/runs/render.png',AMALEH_RENDER_WIDTH:'480',AMALEH_RENDER_HEIGHT:'340'};
 assert.deepEqual(screenshotOptions(['card.html'],env),{page:'card.html',out:join('C:/runs/render.png'),width:480,height:340});
 assert.deepEqual(screenshotOptions(['card.html','--width','600','--out','shot.png'],env).width,600);
 assert.deepEqual([screenshotOptions(['card.html','--out','shot.png'],{}).width,screenshotOptions(['card.html','--out','shot.png'],{}).height],[1280,800]);
 assert.throws(()=>screenshotOptions(['card.html'],{}),/No output path: pass --out, or run inside a render check/);
 assert.throws(()=>screenshotOptions(['a.html','b.html'],env),/Usage: screenshot\.ts/);
 assert.throws(()=>screenshotOptions(['card.html','--height'],env),/--height needs a value/);
 assert.throws(()=>screenshotOptions(['card.html'],{...env,AMALEH_RENDER_WIDTH:'wide'}),/AMALEH_RENDER_WIDTH must be a whole number of pixels from 1 to 8000, not wide/);
});

test('a screenshot of a local page is a complete PNG at the requested size, and a missing page fails before any browser starts',{timeout:120000},async t=>{
 const dir=await temp(t,'amaleh-screenshot-test-'),page=join(dir,'page.html'),out=join(dir,'shot.png');
 await writeFile(page,'<!doctype html><body style="margin:0;background:#F59E0B"></body>');
 await writeFile(out,'stale');
 assert.deepEqual(await screenshot({page,out,width:200,height:120}),{width:200,height:120});
 const shot=decodePng(await readFile(out))!;
 assert.deepEqual(Array.from(shot.rgba.subarray(0,4)),[245,158,11,255]);
 await assert.rejects(()=>screenshot({page:join(dir,'missing.html'),out,width:200,height:120}),/Page .*missing\.html does not exist/);
});

test('the scenario pool lists every scenario folder and names them when the input names none',async()=>{
 const ids=await scenarioIds();
 for(const id of ['design-card','utility-modules'])assert.ok(ids.includes(id),`${id} is in the pool`);
 await assert.rejects(()=>loadScenario(undefined),/Name the scenario to run in input\.scenario; the pool holds: .*design-card.*utility-modules/);
 await assert.rejects(()=>loadScenario('../scripts'),/the pool holds/);
});

test('every scenario prepares its fixtures in a Git commit, so a file a task writes reaches the scope check inside its resources, and plans as a valid contract',async t=>{
 for(const id of await scenarioIds()){
  const workspace=await temp(t,`amaleh-scenario-${id}-`),scenario=await loadScenario(id);
  await prepare(workspace,id,scenario);
  const {root,tasks,spaces}=await prepare(workspace,id,scenario);
  for(const path of Object.keys(scenario.fixtures))await readFile(join(root,path));
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'',`scenario ${id} commits every fixture`);
  assert.deepEqual(Object.keys(spaces).sort(),tasks.map(t=>t.id).sort());
  for(const task of tasks){
   const written=task.resources.filter(r=>!/[*?[]/.test(r));
   assert.ok(written.length,`task ${task.id} of scenario ${id} names the file it writes`);
   for(const path of written)await writeFile(join(spaces[task.id],path),'written by the task');
   const diff=await taskDiff(workspace,spaces[task.id]);
   assert.deepEqual(diff?.untracked.sort(),[...written].sort(),`scenario ${id} task ${task.id} sees its own new files`);
   assert.ok(diff!.untracked.every(path=>task.resources.some(r=>inScope(r,path))),`scenario ${id} task ${task.id} writes inside its resources`);
  }
  const store=await c.start(workspace,{shape:clearCut,id:'pool',host:{kind:'codex',model:'gpt-6-astra'},intent:scenario.intent,criteria:scenario.criteria,constraints:scenario.constraints});
  await c.plan(store,{tasks,integrationChecks:[]});
  assert.equal((await store.load()).tasks.length,tasks.length,`scenario ${id} plans`);
 }
});

test('the scorecard counts each model as worker, reviewer and visual judge, and counts its provider failures',()=>{
 const event=(type:string,detail:object)=>({type,detail}) as unknown as c.Run['events'][number];
 const state={events:[
  event('route-used',{purpose:'worker',model:'deepseek/flash'}),
  event('claimed',{model:'deepseek/flash'}),
  event('visual-judged',{model:'xiaomi/flash',verdict:'match'}),
  event('route-used',{purpose:'reviewer',model:'xiaomi/flash'}),
  event('provider-unavailable',{model:'xiaomi/flash',purpose:'reviewer'}),
  event('model-routed',{purpose:'reviewer',model:'z-ai/flash'}),
  event('route-used',{purpose:'reviewer',model:'z-ai/flash'})]} as c.Run;
 assert.deepEqual(modelUse(state),{
  'deepseek/flash':{worker:1,reviewer:0,judge:0,unavailable:0},
  'xiaomi/flash':{worker:0,reviewer:1,judge:1,unavailable:1},
  'z-ai/flash':{worker:0,reviewer:1,judge:0,unavailable:0}});
});

test('the design-card verdict passes the page that made the picture and fails a wrong theme and a pasted picture',{timeout:180000},async t=>{
 const workspace=await temp(t,'amaleh-design-card-'),scenario=await loadScenario('design-card');
 const {root,spaces}=await prepare(workspace,'design-card',scenario);
 const run=(card:string)=>writeFile(join(spaces.card,'card.html'),card).then(()=>scenario.verdict({root,spaces,state:{} as c.Run,health:{} as never}));
 const source=await readFile(join(scenariosDir,'design-card','source.html'),'utf8');
 const exact=await run(source);
 assert.deepEqual(exact.map(r=>[r.name,r.pass]),[['text of the design',true],['key colors of the design',true],['layout against the design',true]],JSON.stringify(exact));
 const light=await run(source.replace('background: #0F172A','background: #F1F5F9').replace('background: #1E293B','background: #FFFFFF'));
 assert.deepEqual(light.map(r=>r.pass),[true,false,false],JSON.stringify(light));
 const pasted=await run(`<!doctype html><body style="margin:0"><img src="${join(root,'design','card.png').replace(/\\/g,'/')}"></body>`);
 assert.equal(pasted[0].pass,false,'a page that only shows the picture has none of its text');
 assert.match(pasted[0].value,/missing: Monthly revenue, \$48,250/);
 await rm(join(spaces.card,'card.html'));
 const missing=await scenario.verdict({root,spaces,state:{} as c.Run,health:{} as never});
 assert.deepEqual(missing.map(r=>r.pass),[false]);
});
