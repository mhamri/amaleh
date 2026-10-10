import {fixtureClaim,clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as c from '../scripts/core.ts';
import { delegate } from '../scripts/delegate.ts';
import { designBriefSection, describeMeasuredElements, measuredElements, visualDifference } from '../scripts/design.ts';
import { decodePng } from '../scripts/png.ts';
import { cardBars, cardPng, cardText, solidPng } from './png-fixture.ts';

const design=solidPng(48,32,(x,y)=>y<8?[15,23,42]:x<24?[56,189,248]:[245,158,11]);
const built=solidPng(48,32,(x,y)=>y<8?[15,23,42]:x<24?[56,189,248]:[245,159,12]);
const picture='design/card.png';
const writeRender=(bytes:Buffer|string)=>`require('fs').writeFileSync(process.env.AMALEH_RENDER,Buffer.from(${JSON.stringify(Buffer.from(bytes).toString('base64'))},'base64'))`;
const renderCheck=(script:string,id='render'):c.Check=>({id,command:process.execPath,args:['-e',script],role:'probe',render:picture});
const designTask=(checks:c.Check[],extra:Partial<c.TaskInput>={}):c.TaskInput=>({id:'card',title:'Card',goal:'Build the card in the picture',phase:'one',deps:[],resources:['card'],criteria:['The card matches the picture'],kind:'code',images:[picture],checks,...extra});

async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-design-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'design'));await writeFile(join(dir,picture),design);await writeFile(join(dir,'card.html'),'<p>card</p>');
 const store=await c.start(dir,{shape:clearCut,id:'design',host:{kind:'codex',model:'gpt-6-astra'},intent:'Build the card from its picture',criteria:['The card matches the picture']});
 return {dir,store};
}
async function fakeJudge(t:any,dir:string,body:string){
 const path=join(dir,'fake-judge.mjs');
 await writeFile(path,`import {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(join(dir,'judge-calls.jsonl'))},JSON.stringify(process.argv.slice(2))+'\\n');\n${body}`);
 const old=process.env.AMALEH_VISUAL_JUDGE;process.env.AMALEH_VISUAL_JUDGE=path;
 t.after(()=>{if(old===undefined)delete process.env.AMALEH_VISUAL_JUDGE;else process.env.AMALEH_VISUAL_JUDGE=old;});
 return async()=>(await readFile(join(dir,'judge-calls.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(line=>JSON.parse(line) as string[]);
}
const verdict=(value:object)=>`console.log(${JSON.stringify(JSON.stringify(value))});`;
const matches=verdict({verdict:'match',model:'judge/flash',summary:'Same card',differences:[{area:'title',expected:'Segoe UI',actual:'Arial',severity:'minor'}]});
const differs=verdict({verdict:'differs',model:'judge/flash',summary:'The chart is missing',differences:[{area:'chart',expected:'six bars',actual:'no chart',severity:'blocking'}]});
async function planned(t:any,checks:c.Check[]){
 const {dir,store}=await fixture(t);
 await c.plan(store,{tasks:[designTask(checks)],integrationChecks:[]});
 await store.transaction(s=>{c.taskOf(s,'card').workspace=dir;});
 return {dir,store};
}
async function delivered(t:any,checks:c.Check[]){
 const {dir,store}=await planned(t,checks);
 await fixtureClaim(store,'card',{workspace:dir,model:'z-ai/glm-flash'});
 await c.result(store,'card',{});
 return {dir,store};
}
const artifactOf=async(store:c.Store,artifact:string)=>JSON.parse(await store.readArtifact(artifact));

test('a measured element or text line outside the size, place or ink color limits is a blocking difference that names the numbers, and one inside them is not',()=>{
 const design=decodePng(cardPng())!;
 const squashed=measuredElements(design,decodePng(cardPng([{...cardBars[0],width:16},{...cardBars[1],y:46}],{...cardText,height:12,color:[100,116,139]}))!)!;
 assert.deepEqual([squashed.solids,squashed.solidsCompared,squashed.texts,squashed.textsCompared],[3,3,1,1]);
 assert.deepEqual(squashed.differences,[
  {area:'the #38BDF8 element at x 50, y 40 of the design',expected:'20x40 pixels at x 50, y 40',actual:'20x40 pixels at x 50, y 46: top edge 6 pixels lower, bottom edge 6 pixels lower',severity:'blocking'},
  {area:'the #38BDF8 element at x 20, y 50 of the design',expected:'20x30 pixels at x 20, y 50',actual:'16x30 pixels at x 20, y 50: width 20% smaller (4 pixels)',severity:'blocking'},
  {area:'the #F8FAFC text line at x 20, y 20 of the design',expected:'16x8 pixels at x 20, y 20',actual:'16x12 pixels at x 20, y 20: height 50% larger (4 pixels), ink color #64748B instead of #F8FAFC',severity:'blocking'}]);
 assert.equal(describeMeasuredElements(squashed),"3 of the design's 3 solid elements were found in the build with the same count per color, 1 of its 1 text lines was found near their place, and 3 of the found ones are outside the size, place and ink color limits");
 const close=measuredElements(design,decodePng(cardPng([{...cardBars[0],width:17,x:22},{...cardBars[1],y:44,height:36}],{...cardText,y:24,color:[226,232,240]}))!)!;
 assert.deepEqual(close.differences,[],'3 pixels narrower, 2 to the right, an edge or a text line 4 pixels away, and an ink color 31 away are inside the limits');
 assert.equal(measuredElements(design,decodePng(solidPng(100,100,()=>[15,23,42]))!),undefined,'a render of another size is not measured');
 assert.match(visualDifference.blocking,/an element or text line whose width or height differs from the design by more than 10% and more than 3 pixels; an element or text line edge that is more than 2% of the picture's width or height, and more than 4 pixels, away from its place in the design; a text line whose ink color is more than 40 away from the design's ink color/);
});

test('the worker brief lists each solid element and text line of the picture with its size, place and color, and says the check measures them',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-design-brief-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'card.png');await writeFile(path,cardPng());
 const brief=await designBriefSection([{source:'design/card.png',path}],[{id:'render',render:'design/card.png'}]);
 assert.ok(brief.includes(`Visual check render compares your work with it\n  - Solid elements measured in it, as color, width x height in pixels, and top-left corner: #1E293B 120x80 at x 10, y 10; #38BDF8 20x40 at x 50, y 40; #38BDF8 20x30 at x 20, y 50\n  - Text lines measured in it, as ink color, width x height in pixels, and top-left corner: #F8FAFC 16x8 at x 20, y 20\n`),brief);
 assert.match(brief,/Build each element and each text line at the size, place and color listed, in picture pixels\. The visual check measures the same things in your screenshot\./);
 await writeFile(path,solidPng(24,16,()=>[15,23,42]));
 assert.doesNotMatch(await designBriefSection([{source:'design/card.png',path}],[]),/Solid elements measured|Text lines measured|A solid element is/,'a picture without solid elements or text lines gets no element lines');
});

test('plan copies each design picture into the run, keeps the source names, and refuses a picture that is not a PNG',async t=>{
 const {dir,store}=await fixture(t);
 await c.plan(store,{tasks:[designTask([renderCheck('process.exit(1)')])],integrationChecks:[]});
 const task=c.taskOf(await store.load(),'card');
 assert.deepEqual(task.images,[picture]);
 assert.equal(task.imageCopies!.length,1);
 assert.equal(task.imageCopies![0].source,picture);
 assert.ok(task.imageCopies![0].path.startsWith(join(store.root,'images')));
 assert.deepEqual(await readFile(task.imageCopies![0].path),design,'the stored copy is the picture byte for byte');
 await writeFile(join(dir,picture),solidPng(4,4,()=>[0,0,0]));
 assert.deepEqual(await readFile(c.taskOf(await store.load(),'card').imageCopies![0].path),design,'a later change to the source does not change what the run compares against');
 await assert.rejects(()=>c.plan(store,{tasks:[{...designTask([renderCheck('process.exit(1)')]),id:'other',images:['design/card.jpg'],checks:[{...renderCheck('process.exit(1)'),render:'design/card.jpg'}]}],integrationChecks:[]}),/design\/card\.jpg of task other is not a PNG file/);
});

test('plan refuses a picture it cannot read or decode before it records anything',async t=>{
 const {dir,store}=await fixture(t);
 await assert.rejects(()=>c.plan(store,{tasks:[designTask([{...renderCheck('process.exit(1)'),render:'design/none.png'}],{images:['design/none.png']})],integrationChecks:[]}),/Design picture design\/none\.png is not readable/);
 await writeFile(join(dir,'design','fake.png'),'not a picture');
 await assert.rejects(()=>c.plan(store,{tasks:[designTask([{...renderCheck('process.exit(1)'),render:'design/fake.png'}],{images:['design/fake.png']})],integrationChecks:[]}),/design\/fake\.png at .* is not a readable PNG file/);
 assert.equal((await store.load()).tasks.length,0);
 assert.deepEqual(await readdir(join(store.root,'images')).catch(()=>[]),[],'a refused plan stores no picture');
});

test('a design picture needs a probe that renders it, and noProbe does not excuse it',async t=>{
 const {store}=await fixture(t);
 await assert.rejects(()=>c.plan(store,{tasks:[designTask([],{noProbe:'Visual work'})],integrationChecks:[]}),/has design picture design\/card\.png but no check renders it.*noProbe does not excuse a design picture/);
 await assert.rejects(()=>c.plan(store,{tasks:[designTask([{...renderCheck('process.exit(1)'),role:'guard'}])],integrationChecks:[]}),/renders a design picture, so its role must be probe/);
 await assert.rejects(()=>c.plan(store,{tasks:[designTask([{...renderCheck('process.exit(1)'),render:'design/other.png'}])],integrationChecks:[]}),/renders "design\/other\.png", which is not one of the task's images \(design\/card\.png\)/);
 await assert.rejects(()=>c.plan(store,{tasks:[designTask([renderCheck('process.exit(1)')],{images:[picture,picture]})],integrationChecks:[]}),/lists design picture design\/card\.png more than once/);
});

test('a plan run again with the same pictures keeps the task, and a changed picture list is a contract change',async t=>{
 const {store}=await fixture(t);
 const task=designTask([renderCheck('process.exit(1)')]);
 await c.plan(store,{tasks:[task],integrationChecks:[]});
 await c.plan(store,{tasks:[task],integrationChecks:[]});
 await assert.rejects(()=>c.plan(store,{tasks:[{...task,images:[]}],integrationChecks:[]}),/Existing task contract changed/);
});

test('amend adds a picture with its render probe, keeps the copy of an unchanged picture and removes all copies with the last picture',async t=>{
 const {dir,store}=await fixture(t);
 await c.plan(store,{tasks:[{id:'card',title:'Card',goal:'Build the card',phase:'one',deps:[],resources:['card'],criteria:['works'],kind:'code',checks:[{id:'test',command:process.execPath,args:['-e','process.exit(1)'],role:'probe'}]}],integrationChecks:[]});
 const base=c.taskOf(await store.load(),'card');
 const contract={id:'card',title:base.title,goal:base.goal,phase:base.phase,deps:base.deps,resources:base.resources,criteria:base.criteria,kind:base.kind,checks:base.checks};
 await assert.rejects(()=>c.amend(store,{id:'card',reason:'The design arrived',task:{...contract,images:[picture]}}),/no check renders it/);
 await c.amend(store,{id:'card',reason:'The design arrived',task:{...contract,images:[picture],checks:[...contract.checks,renderCheck('process.exit(1)')]}});
 const amended=c.taskOf(await store.load(),'card');
 assert.deepEqual([amended.images,amended.imageCopies!.map(i=>i.source)],[[picture],[picture]]);
 await writeFile(join(dir,'design','second.png'),built);
 await c.amend(store,{id:'card',reason:'A second state',task:{...contract,images:[picture,'design/second.png'],checks:[...contract.checks,renderCheck('process.exit(1)'),{...renderCheck('process.exit(1)','second'),render:'design/second.png'}]}});
 const twice=c.taskOf(await store.load(),'card');
 assert.equal(twice.imageCopies![0].path,amended.imageCopies![0].path,'an unchanged picture keeps its stored copy');
 await c.amend(store,{id:'card',reason:'The design was dropped',task:{...contract,images:[]}});
 const dropped=c.taskOf(await store.load(),'card');
 assert.deepEqual([dropped.images,dropped.imageCopies],[undefined,undefined]);
});

test('a render check passes only when the judge matches a real screenshot written to AMALEH_RENDER at the picture size',async t=>{
 const {dir,store}=await delivered(t,[renderCheck(`${writeRender(built)};require('fs').writeFileSync('size.txt',process.env.AMALEH_RENDER_WIDTH+'x'+process.env.AMALEH_RENDER_HEIGHT)`)]);
 const calls=await fakeJudge(t,dir,matches);
 const out=await c.check(store,'card','render');
 assert.equal(out.code,0);
 assert.equal((out as {visual?:string}).visual,undefined);
 assert.equal(await readFile(join(dir,'size.txt'),'utf8'),'48x32');
 const [args]=await calls(),task=c.taskOf(await store.load(),'card');
 assert.equal(args[0],task.imageCopies![0].path,'the judge compares against the stored copy');
 assert.deepEqual(await readFile(args[1]),built,'the judge reads the screenshot the check wrote');
 assert.equal(args[4],'design/card','the judge seed names the run and the task');
 const artifact=await artifactOf(store,out.artifact);
 assert.equal(artifact.render.design,picture);
 assert.match(artifact.stdout,/matches the design\. Same card\n- \[minor\] title: the design shows Segoe UI; the build shows Arial/);
 const judged=(await store.load()).events.find(e=>e.type==='visual-judged')!.detail as any;
 assert.deepEqual([judged.verdict,judged.model,judged.differences,judged.blocking],['match','judge/flash',1,0]);
});

test('a judged difference fails the check, marks the receipt and lists each difference for the repair',async t=>{
 const {dir,store}=await delivered(t,[renderCheck(writeRender(built))]);
 await fakeJudge(t,dir,differs);
 const out=await c.check(store,'card','render');
 assert.equal(out.code,1);
 assert.equal((out as {visual?:string}).visual,'differs');
 assert.equal(c.taskOf(await store.load(),'card').receipts.find(r=>r.id==='render')!.visual,'differs');
 assert.match((await artifactOf(store,out.artifact)).stdout,/differs from the design\. The chart is missing\n- \[blocking\] chart: the design shows six bars; the build shows no chart/);
});

for(const [name,script,reason] of [
 ['writes no picture','process.exit(0)',/exited 0 but wrote no picture to AMALEH_RENDER/],
 ['writes a file that is not a PNG',writeRender('<svg/>'),/which is not a PNG file/],
 ['copies the design picture',writeRender(design),/is the design picture design\/card\.png itself, not a screenshot of the built work/]] as const)
 test(`a render command that ${name} fails without asking the judge`,async t=>{
  const {dir,store}=await delivered(t,[renderCheck(script)]);
  const calls=await fakeJudge(t,dir,matches);
  const out=await c.check(store,'card','render');
  assert.equal(out.code,1);
  assert.match((await artifactOf(store,out.artifact)).stderr,reason);
  assert.deepEqual(await calls(),[]);
 });

test('a render command that fails keeps its own exit code and output, and the judge is not asked',async t=>{
 const {dir,store}=await delivered(t,[renderCheck(`console.error('page missing');process.exit(3)`)]);
 const calls=await fakeJudge(t,dir,matches);
 const out=await c.check(store,'card','render');
 assert.equal(out.code,3);
 assert.match((await artifactOf(store,out.artifact)).stderr,/^page missing/);
 assert.deepEqual(await calls(),[]);
});

test('a judge that cannot answer fails the check and says why',async t=>{
 const {dir,store}=await delivered(t,[renderCheck(writeRender(built))]);
 await fakeJudge(t,dir,`console.error('No visual judge answered: provider down');process.exit(2);`);
 const out=await c.check(store,'card','render');
 assert.equal(out.code,1);
 assert.match((await artifactOf(store,out.artifact)).stderr,/The visual judge could not compare the render with design\/card\.png: No visual judge answered: provider down/);
 assert.equal((await store.load()).events.some(e=>e.type==='visual-judged'),false);
});

test('delegate refuses a design task whose render already matches before any work, and judges it to decide',async t=>{
 const {dir,store}=await planned(t,[renderCheck(writeRender(built))]);
 const calls=await fakeJudge(t,dir,matches);
 const out=await delegate(store,'card',{workspace:dir},{
  runWorker:(async()=>{throw new Error('worker should not launch');}) as any,
  runReviewer:(async()=>{throw new Error('reviewer should not launch');}) as any,
  fetcher:(async()=>{throw new Error('no network in this test');}) as any});
 assert.equal(out.outcome,'refused');
 assert.match(String((out as {reason?:string}).reason),/render.*already passes/);
 assert.equal((await calls()).length,1);
});

test('a render that differs on the unchanged checkout lets the worker start',async t=>{
 const {dir,store}=await planned(t,[renderCheck(writeRender(built))]);
 await fakeJudge(t,dir,differs);
 const out=await delegate(store,'card',{workspace:dir},{
  runWorker:(async()=>{throw new Error('worker launched');}) as any,
  runReviewer:(async()=>{throw new Error('reviewer should not launch');}) as any,
  fetcher:(async()=>{throw new Error('no network in this test');}) as any});
 assert.notEqual(out.outcome,'refused');
});

test('each design picture is a review obligation that cannot be marked not applicable',async t=>{
 const {dir,store}=await delivered(t,[renderCheck(writeRender(built))]);
 await fakeJudge(t,dir,matches);
 await c.check(store,'card','render');
 const state=await store.load(),obligations=c.reviewObligations(state,c.taskOf(state,'card'));
 const own=obligations.find(o=>o.id==='design:1')!;
 assert.match(own.question,/compare the latest render of this work with design picture design\/card\.png, both attached to your prompt/);
 const coverage=obligations.map(o=>({id:o.id,status:o.id==='design:1'?'not-applicable' as const:'covered' as const,evidence:'Synthetic fixture'}));
 const fingerprint=await c.fingerprint(dir);
 await assert.rejects(()=>c.review(store,'card',{model:'deepseek/flash',fingerprint,findings:[],report:'review',coverage}),/criteria, design pictures and reopen reasons cannot be not-applicable/);
});
