import {clearCut} from '../execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../../scripts/core.ts';
import { loadScenario, modelUse, prepare, scenarioIds, scenariosDir } from './bench.ts';
import { missingPictureFont } from './design-card/scenario.ts';
import { taskDiff } from '../../scripts/adapters.ts';
import { inScope } from '../../scripts/resources.ts';
import { execFileSync } from 'node:child_process';

async function temp(t:any,prefix:string){const dir=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

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

test('the design-card verdict passes the page that made the picture and a real close build, and fails a wrong theme, squashed or resized builds and a pasted picture',async t=>{
 const missingFont=await missingPictureFont();
 if(missingFont){t.skip(missingFont);return;}
 const workspace=await temp(t,'amaleh-design-card-'),scenario=await loadScenario('design-card');
 const {root,spaces}=await prepare(workspace,'design-card',scenario);
 const run=(card:string)=>writeFile(join(spaces.card,'card.html'),card).then(()=>scenario.verdict({root,spaces,state:{} as c.Run,health:{} as never}));
 const liveRun=async(id:number)=>run(await readFile(join(scenariosDir,'design-card','builds',`design-card-${id}.html`),'utf8'));
 const source=await readFile(join(scenariosDir,'design-card','source.html'),'utf8');
 const exact=await run(source);
 assert.deepEqual(exact.map(r=>[r.name,r.pass]),[['text of the design',true],['key colors of the design',true],['layout against the design',true],['measured elements against the design',true]],JSON.stringify(exact));
 assert.equal(exact[3].value,"8 of the design's 8 solid elements were found in the build with the same count per color, 9 of its 9 text lines were found near their place, and 0 of the found ones are outside the size, place and ink color limits");
 const close=await liveRun(1);
 assert.deepEqual(close.map(r=>r.pass),[true,true,true,true],`the card deepseek built in live run design-card-1 passes: ${JSON.stringify(close)}`);
 const squashed=await liveRun(11);
 assert.deepEqual(squashed.map(r=>r.pass),[true,true,true,false],`the squashed card glm built in live run design-card-11 passed the old rows and fails the element row: ${JSON.stringify(squashed)}`);
 assert.match(squashed[3].value,/the #38BDF8 element at x 70, y 213 of the design: 40x52 pixels at x 61, y 207: width 18% smaller \(9 pixels\), right edge 18 pixels to the left/);
 assert.match(squashed[3].value,/the #1E293B element at x 46, y 30 of the design: 414x282 pixels at x 33, y 29: left edge 13 pixels to the left/);
 const larger=await liveRun(12);
 assert.deepEqual(larger.map(r=>r.pass),[true,true,true,false],`the card xiaomi built in live run design-card-12 has every box in place and fails on its text: ${JSON.stringify(larger)}`);
 assert.match(larger[3].value,/the #F8FAFC text line at x 71, y 91 of the design: 143x37 pixels at x 72, y 89: height 12% larger \(4 pixels\)/);
 assert.match(larger[3].value,/the #5E7489 text line at x 86, y 275 of the design: 20x10 pixels at x 84, y 276: width 25% larger \(4 pixels\), ink color #929FA7 instead of #5E7489/);
 const smaller=await liveRun(14);
 assert.deepEqual(smaller.map(r=>r.pass),[true,true,true,false],`the card glm built in live run design-card-14 has every box in place and fails on its text: ${JSON.stringify(smaller)}`);
 assert.match(smaller[3].value,/the #F8FAFC text line at x 71, y 91 of the design: 110x28 pixels at x 71, y 90: width 17% smaller \(22 pixels\), height 15% smaller \(5 pixels\)/);
 const light=await run(source.replace('background: #0F172A','background: #F1F5F9').replace('background: #1E293B','background: #FFFFFF'));
 assert.deepEqual(light.map(r=>r.pass),[true,false,false,false],JSON.stringify(light));
 const pasted=await run(`<!doctype html><body style="margin:0"><img src="${join(root,'design','card.png').replace(/\\/g,'/')}"></body>`);
 assert.equal(pasted[0].pass,false,'a page that only shows the picture has none of its text');
 assert.match(pasted[0].value,/missing: Monthly revenue, \$48,250/);
 await rm(join(spaces.card,'card.html'));
 const missing=await scenario.verdict({root,spaces,state:{} as c.Run,health:{} as never});
 assert.deepEqual(missing.map(r=>r.pass),[false]);
});
