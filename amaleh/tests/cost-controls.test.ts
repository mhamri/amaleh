import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {taskDiff,piRun} from '../scripts/adapters.ts';
import {spend,trace,diagnostics} from '../scripts/telemetry.ts';
import {catalogCost,priceBook} from '../scripts/pricing.ts';
import {processHealth} from '../scripts/host-diagnostics.ts';
import * as c from '../scripts/core.ts';
import {clearCut} from './execution-fixture.ts';

async function temp(t:any,prefix:string){const dir=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.email=fixture@example.invalid','-c','user.name=fixture',...args],{cwd,encoding:'utf8'});

test('the reviewer diff covers committed and uncommitted work since the task forked from the main checkout',async t=>{
 const main=await temp(t,'amaleh-diff-');
 git(main,'init','-q');await mkdir(join(main,'site'));await writeFile(join(main,'site','hero.tsx'),'old\n');await writeFile(join(main,'readme.md'),'root\n');
 git(main,'add','.');git(main,'commit','-qm','base');
 const tree=join(main,'..',`${main.split(/[\\/]/).pop()}-wt`);t.after(()=>rm(tree,{recursive:true,force:true}));
 git(main,'worktree','add','-q',tree);
 const workspace=join(tree,'site');
 await writeFile(join(workspace,'hero.tsx'),'committed\n');git(tree,'commit','-qam','task work');
 await writeFile(join(workspace,'hero.tsx'),'uncommitted\n');await writeFile(join(workspace,'new.tsx'),'fresh\n');
 await writeFile(join(main,'readme.md'),'main moved on\n');git(main,'commit','-qam','unrelated');
 const diff=await taskDiff(main,workspace);
 assert.ok(diff);
 assert.match(diff.patch,/-old\n\+uncommitted/);
 assert.doesNotMatch(diff.patch,/readme/,'changes outside the task workspace are not the task\'s');
 assert.deepEqual(diff.untracked,['new.tsx']);
 assert.match(diff.stat,/hero\.tsx/);
});

test('a workspace outside Git yields no diff rather than a misleading one',async t=>{
 const dir=await temp(t,'amaleh-nodiff-');
 assert.equal(await taskDiff(dir,dir),undefined);
});

const turn=(stopReason:string,text='working')=>({type:'message_end',message:{role:'assistant',model:'test/model',content:[{type:'text',text}],stopReason,usage:{input:10,output:3,cacheRead:100,cost:{total:.001}}}});
test('a call that keeps using tools past its turn limit is stopped with the reason',async t=>{
 const dir=await temp(t,'amaleh-turns-'),entry=join(dir,'fake-pi.ts');
 const lines=Array.from({length:8},()=>JSON.stringify(turn('toolUse'))).join('\n');
 await writeFile(entry,`process.stdout.write(${JSON.stringify(lines+'\n')});setTimeout(()=>{},20000);`);
 const old={key:process.env.OPENROUTER_API_KEY,pi:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 process.env.OPENROUTER_API_KEY='sk-or-fake-turn-limit-secret-123';process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 t.after(()=>{for(const [name,value] of [['OPENROUTER_API_KEY',old.key],['AMALEH_PI_ENTRY',old.pi],['AMALEH_NODE',old.node]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;});
 const started=Date.now();
 await assert.rejects(()=>piRun({workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics'),maxTurns:5,attempts:1}),/Stopped after 5 turns, the limit for this call/);
 assert.ok(Date.now()-started<15000,'the process tree is killed instead of waiting for it');
 const report=await diagnostics(join(dir,'.diagnostics'));
 assert.ok(report.operations[0].events.some(e=>e.stage==='turn-limit'));
});

test('spend splits estimated cost and cached tokens by model, role and task',async t=>{
 const root=await temp(t,'amaleh-spend-');
 const call=async(model:string,session:string,readOnly:boolean,cost:number)=>{const tr=await trace(root,'pi',{model,readOnly,sessionDir:join(root,'sessions',session)});await tr.write('usage',{inputTokens:10,outputTokens:5,cacheRead:1000,cost,costSource:'pi-estimate'});await tr.end('success');};
 await call('moonshotai/kimi-k3','hero',false,2);
 await call('xiaomi/mimo-v2.5','hero-review-1790000000000',true,.5);
 await call('xiaomi/mimo-v2.5','hero-review-1790764601519-2036a48b',true,.125);
 await call('xiaomi/mimo-v2.5','docs',false,.25);
 const report=await diagnostics(root),costs=spend(report.operations);
 assert.equal(report.totals.cacheReadTokens,4000);
 assert.deepEqual(costs.byModel.map(r=>[r.key,r.estimatedCost]),[['moonshotai/kimi-k3',2],['xiaomi/mimo-v2.5',.875]]);
 assert.deepEqual(costs.byTask.map(r=>[r.key,r.calls]),[['hero',3],['docs',1]],'a reviewer session, with or without its random suffix, is spend of the task it reviewed');
 assert.deepEqual(costs.byRole.map(r=>r.key),['worker','reviewer']);
 assert.deepEqual([costs.total?.estimatedCost,costs.total?.piEstimate,costs.total?.costSource],[2.875,2.875,'pi-estimate'],'without a recorded OpenRouter price, spend falls back to the pi estimate and says so');
});

test('a malformed usage row counts as zero, never as negative money',async t=>{
 const root=await temp(t,'amaleh-spend-malformed-');
 const tr=await trace(root,'pi',{model:'m',readOnly:false,sessionDir:join(root,'sessions','hero')});
 await tr.write('usage',{inputTokens:-2_000_000,outputTokens:'many',cacheRead:null,cost:-0.5,costSource:'pi-estimate'});await tr.end('success');
 const costs=spend((await diagnostics(root)).operations,()=>({prompt:'0.000001',completion:'0.000001'}));
 assert.deepEqual([costs.total?.estimatedCost,costs.total?.piEstimate,costs.total?.inputTokens,costs.total?.outputTokens],[0,0,0,0]);
});

test('catalog cost prices every token kind at its own OpenRouter rate',()=>{
 const turn={inputTokens:1_000_000,cacheRead:2_000_000,cacheWrite:500_000,outputTokens:100_000};
 assert.equal(catalogCost({prompt:'0.000003',completion:'0.000015',input_cache_read:'0.0000003',input_cache_write:'0.00000375'},[turn,turn]),2*(3+.6+1.875+1.5));
 assert.equal(catalogCost({prompt:'0.000001',completion:'0.000002'},[turn]),1+2+.5+.2,'cache tokens without their own rate cost the prompt rate');
 assert.equal(catalogCost({prompt:'0',completion:'0',request:'0.01'},[turn,turn]),.02);
 assert.equal(catalogCost({prompt:'0',completion:'0'},[turn]),0,'a free model costs nothing');
 assert.equal(catalogCost({prompt:'-1',completion:'-1'},[turn]),undefined,'a router placeholder price is not a price');
 assert.equal(catalogCost(undefined,[turn]),undefined);
});

test('each call is priced at the quote routing recorded before it started',()=>{
 const book=priceBook([{at:'2026-09-28T05:00:00.000Z',model:'m',pricing:{prompt:'1',completion:'1'}},{at:'2026-09-28T07:00:00.000Z',model:'m',pricing:{prompt:'2',completion:'2'}}]);
 assert.equal(book('m','2026-09-28T06:00:00.000Z')?.prompt,'1');
 assert.equal(book('m','2026-09-28T08:00:00.000Z')?.prompt,'2');
 assert.equal(book('m','2026-09-28T04:00:00.000Z')?.prompt,'1','a call traced before its first quote uses the earliest quote');
 assert.equal(book('other','2026-09-28T06:00:00.000Z'),undefined);
});

test('health prices spend from the OpenRouter catalog cards its route decisions recorded',async t=>{
 const dir=await temp(t,'amaleh-catalog-spend-');
 const store=await c.start(dir,{shape:clearCut,id:'priced',host:{kind:'claude',model:'claude-opus-5-5'},intent:'Price the run',criteria:['Run priced']});
 const cards=[{id:'stealth/free-alpha',pricing:{prompt:'0',completion:'0'}},{id:'xiaomi/mimo-v2.6-flash',pricing:{prompt:'0.00000014',completion:'0.00000028',input_cache_read:'0.0000000028'}}];
 await store.transaction(s=>{s.decisions.push({id:'route-1',question:'route',criteria:{model_0:'a',model_1:'b'},state:{routing:{models:{model_0:cards[0].id,model_1:cards[1].id}},catalog:{verifiedAt:new Date().toISOString(),models:cards}},revision:s.revision,choice:'model_1',source:'runtime:round-robin'});c.event(s,'model-routed',{id:'route-1'});});
 const call=async(model:string,cost:number)=>{const tr=await trace(store.root,'pi',{model,readOnly:false,sessionDir:join(store.root,'sessions','hero')});await tr.write('usage',{inputTokens:1_000_000,outputTokens:1_000_000,cacheRead:1_000_000,cost,costSource:'pi-estimate'});await tr.end('success');};
 await call('stealth/free-alpha',4.95);await call('xiaomi/mimo-v2.6-flash',4.95);await call('unrouted/model',.5);
 const health=await processHealth(store) as any,rows=Object.fromEntries(health.metrics.spend.byModel.map((r:any)=>[r.key,[r.estimatedCost,r.piEstimate,r.costSource]]));
 assert.deepEqual(rows,{'stealth/free-alpha':[0,4.95,'openrouter-catalog'],'xiaomi/mimo-v2.6-flash':[.423,4.95,'openrouter-catalog'],'unrouted/model':[.5,.5,'pi-estimate']});
 assert.deepEqual([health.metrics.spend.total.estimatedCost,health.metrics.spend.total.costSource],[.923,'mixed']);
});

test('health measures the main model from its transcripts and warns when it reads more than the workers',async t=>{
 const dir=await temp(t,'amaleh-mainmodel-'),transcripts=await temp(t,'amaleh-transcripts-');
 const old=process.env.AMALEH_HOST_TRANSCRIPTS;process.env.AMALEH_HOST_TRANSCRIPTS=transcripts;
 t.after(()=>{if(old===undefined)delete process.env.AMALEH_HOST_TRANSCRIPTS;else process.env.AMALEH_HOST_TRANSCRIPTS=old;});
 const store=await c.start(dir,{shape:clearCut,id:'main',host:{kind:'claude',model:'claude-opus-5-5'},intent:'Measure the main model',criteria:['Main model measured']});
 const tr=await trace(store.root,'pi',{model:'xiaomi/mimo-v2.5',readOnly:false,sessionDir:join(store.root,'sessions','hero')});
 await tr.write('usage',{inputTokens:1000,outputTokens:10,cacheRead:4000,cost:.01,costSource:'pi-estimate'});await tr.end('success');
 const turn=(id:string,at:string,cacheRead:number)=>JSON.stringify({type:'assistant',timestamp:at,message:{id,model:'claude-opus-5-5',usage:{input_tokens:10,cache_read_input_tokens:cacheRead,cache_creation_input_tokens:100,output_tokens:50},content:[{type:'tool_use'}]}});
 const now=new Date().toISOString(),before=new Date(Date.now()-86400000).toISOString();
 await mkdir(join(transcripts,'session','subagents'),{recursive:true});
 await writeFile(join(transcripts,'session.jsonl'),[turn('m1',now,3000),turn('m1',now,3000),turn('old',before,900000),'not json'].join('\n'));
 await writeFile(join(transcripts,'session','subagents','agent.jsonl'),turn('m2',now,3000));
 const health=await processHealth(store) as any;
 assert.deepEqual([health.metrics.mainModel.turns,health.metrics.mainModel.toolCalls,health.metrics.mainModel.cacheReadTokens,health.metrics.mainModel.outputTokens],[2,3,6000,100],'a repeated message id counts once, and a turn before the run does not count');
 assert.ok(health.warnings.some((w:string)=>/main model read 0\.01 million tokens over 2 turn\(s\)/.test(w)),health.warnings.join('\n'));
 const codex=await c.start(await temp(t,'amaleh-mainmodel-codex-'),{shape:clearCut,id:'main',host:{kind:'codex',model:'gpt-6-astra'},intent:'Measure the main model',criteria:['Main model measured']});
 assert.equal(((await processHealth(codex)) as any).metrics.mainModel.available,false);
});

test('health warns when the deep model takes most of the spend, and stays quiet otherwise',async t=>{
 const dir=await temp(t,'amaleh-deepshare-');
 const store=await c.start(dir,{shape:clearCut,id:'share',host:{kind:'claude',model:'claude-opus-5-5'},intent:'Polish the site',criteria:['Site polished']});
 const call=async(model:string,cost:number)=>{const tr=await trace(store.root,'pi',{model,readOnly:false,sessionDir:join(store.root,'sessions','hero')});await tr.write('usage',{inputTokens:1,outputTokens:1,cost,costSource:'pi-estimate'});await tr.end('success');};
 await call('xiaomi/mimo-v2.5',.9);
 assert.ok(!(await processHealth(store) as any).warnings.some((w:string)=>/moonshotai\/kimi-k3 took/.test(w)));
 await call('moonshotai/kimi-k3',1.5);
 const health=await processHealth(store) as any;
 assert.ok(health.warnings.some((w:string)=>/moonshotai\/kimi-k3 took 63% of the \$2\.40 estimated spend across 1 call/.test(w)),health.warnings.join('\n'));
 assert.equal(health.metrics.spend.byModel[0].key,'moonshotai/kimi-k3');
});
