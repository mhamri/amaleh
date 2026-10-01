import {fixtureClaim,clearCut} from './execution-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,realpath,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import * as c from '../scripts/core.ts';
import {reviewer} from '../scripts/adapters.ts';

const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.email=fixture@example.invalid','-c','user.name=fixture',...args],{cwd,encoding:'utf8'});
const card=(id:string)=>({id,created:1,context_length:64000,architecture:{input_modalities:['text']},supported_parameters:['tools'],pricing:{prompt:'0.000001',completion:'0.000002'},description:'Synthetic test card'});
const models={flash:['z-ai/glm-new-flash','deepseek/new-flash','xiaomi/new-flash'],deep:['moonshot/kimi-specialist'],jev:'typesafe/jev-1.13',providerCooldownMs:300000,providerFailovers:3,launchAttempts:3,idleTimeoutMs:900000,slowModelWindowMs:604800000,reviewerMaxTurns:60};
const blocking={id:'f1',lens:'Spec',location:'a/app.txt',scenario:'charges 11 instead of 10',evidence:'observed expected-versus-actual',consequence:'overcharge',blocking:true};
type Call={model:string;continued:boolean;sessionDir:string;prompt:string};

async function fixture(t:any){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'amaleh-repair-review-'))),outside=await mkdtemp(join(tmpdir(),'amaleh-repair-review-pi-'));
 t.after(()=>Promise.all([rm(dir,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})]));
 git(dir,'init','-q');await mkdir(join(dir,'a'));await writeFile(join(dir,'a','app.txt'),'original\n');await writeFile(join(dir,'.gitignore'),'/.amaleh/\n');
 git(dir,'add','.');git(dir,'commit','-qm','base');
 const log=join(outside,'calls.jsonl'),script=join(outside,'findings.json'),entry=join(outside,'fake-pi.ts');
 await writeFile(join(outside,'models.json'),JSON.stringify(models));
 await writeFile(entry,`import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
const argv=process.argv,prompt=argv.at(-1),model=argv[argv.indexOf('--model')+1],sessionDir=argv[argv.indexOf('--session-dir')+1];
const calls=existsSync(${JSON.stringify(log)})?readFileSync(${JSON.stringify(log)},'utf8').split('\\n').filter(Boolean).length:0;
appendFileSync(${JSON.stringify(log)},JSON.stringify({model,continued:argv.includes('--continue'),sessionDir,prompt})+'\\n');
const handoff=prompt.match(/"([^"]*\\.md)"/)[1];
const packet=JSON.parse(readFileSync(join(dirname(handoff),'review-packet.md'),'utf8').match(/\`\`\`json\\n([\\s\\S]*?)\\n\`\`\`/)[1]);
const script=JSON.parse(readFileSync(${JSON.stringify(script)},'utf8'));
const findings=script[Math.min(calls,script.length-1)];
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',model,content:[{type:'text',text:JSON.stringify({report:'Synthetic reviewer fixture',coverage:packet.obligations.map((o:any)=>({id:o.id,status:'covered',evidence:'Synthetic protocol fixture only'})),findings})}],stopReason:'stop'}}));
console.log(JSON.stringify({type:'agent_end'}));`);
 const old={fetch:globalThis.fetch,models:process.env.AMALEH_MODELS,key:process.env.OPENROUTER_API_KEY,entry:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE};
 t.after(()=>{globalThis.fetch=old.fetch;for(const [name,value] of [['AMALEH_MODELS',old.models],['OPENROUTER_API_KEY',old.key],['AMALEH_PI_ENTRY',old.entry],['AMALEH_NODE',old.node]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;});
 process.env.AMALEH_MODELS=join(outside,'models.json');process.env.OPENROUTER_API_KEY='sk-repair-review-fixture-not-real';process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 globalThis.fetch=(async()=>Response.json({data:models.flash.map(card)})) as typeof fetch;
 const store=await c.start(dir,{shape:clearCut,id:'repair-review',host:{kind:'codex',model:'gpt-6-astra'},intent:'Review only the repair',criteria:['The repair is verified']});
 await c.plan(store,{tasks:[{id:'a',title:'a',goal:'Charge the correct amount',phase:'one',deps:[],resources:['a'],criteria:['correct amount'],checks:[],kind:'code',noProbe:'Test fixture; the review flow is asserted by the test'}],integrationChecks:[]});
 const calls=async():Promise<Call[]>=>(await readFile(log,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const work=async(content:string)=>{await fixtureClaim(store,'a',{workspace:dir,model:'z-ai/glm-new-flash'});await writeFile(join(dir,'a','app.txt'),content);await c.result(store,'a',{});};
 return {dir,store,calls,work,script:(findings:unknown[][])=>writeFile(script,JSON.stringify(findings))};
}
const handoffOf=(prompt:string)=>prompt.match(/"([^"]*\.md)"/)![1];

test('the review after a repair continues the first reviewer\'s session and reads only the repair diff',{timeout:120000},async t=>{
 const {dir,store,calls,work,script}=await fixture(t);
 await script([[blocking],[]]);
 await work('first attempt\n');
 await reviewer(store,'a',undefined,['Spec']);
 await c.repair(store,'a');
 await work('repaired\n');
 const second=await reviewer(store,'a',undefined,['Spec']);
 assert.deepEqual((second as {findings:unknown[]}).findings,[]);
 const [first,followUp]=await calls();
 assert.equal(first.continued,false);
 assert.match(first.prompt,/independent read-only reviewer/);
 assert.match(first.prompt,/otherTasks lists the files each other task owns/,'the reviewer is told which files belong to other tasks');
 const packet=JSON.parse((await readFile(join(dirname(handoffOf(first.prompt)),'review-packet.md'),'utf8')).match(/```json\n([\s\S]*?)\n```/)![1]);
 assert.deepEqual([packet.resources,packet.otherTasks],[['a'],[]]);
 assert.equal(followUp.continued,true,'the reviewer continues its own session');
 assert.equal(followUp.model,first.model,'the same model verifies its own findings');
 assert.equal(followUp.sessionDir,first.sessionDir);
 assert.match(followUp.prompt,/Verify the repair; do not review the whole task again/);
 const brief=await readFile(handoffOf(followUp.prompt),'utf8');
 assert.match(brief,/"id": "f1"/,'the brief lists the blocking finding to verify');
 const patch=await readFile(join(dirname(handoffOf(followUp.prompt)),'repair-diff.patch'),'utf8');
 assert.match(patch,/-first attempt\n\+repaired/,'the diff starts at the reviewed work, not at the base commit');
 assert.doesNotMatch(patch,/original/);
 const sessions=(await store.load()).events.filter(e=>e.type==='review-session').map(e=>(e.detail as {followUp?:boolean}).followUp);
 assert.deepEqual(sessions,[undefined,true]);
 await c.accept(store,'a');
 assert.equal(c.taskOf(await store.load(),'a').status,'accepted');
 assert.equal(await readFile(join(dir,'a','app.txt'),'utf8'),'repaired\n');
});

test('a changed contract gets a fresh full review, not a review of the repair',{timeout:120000},async t=>{
 const {store,calls,work,script}=await fixture(t);
 await script([[blocking],[]]);
 await work('first attempt\n');
 await reviewer(store,'a',undefined,['Spec']);
 const contract=c.taskOf(await store.load(),'a');
 await c.amend(store,{id:'a',reason:'The amount rule changed',task:{id:'a',title:contract.title,goal:'Charge the corrected amount',phase:contract.phase,deps:contract.deps,resources:contract.resources,criteria:contract.criteria,kind:contract.kind,checks:contract.checks,noProbe:contract.noProbe}});
 await work('repaired\n');
 await reviewer(store,'a',undefined,['Spec']);
 const [,second]=await calls();
 assert.equal(second.continued,false);
 assert.match(second.prompt,/independent read-only reviewer/);
});

test('a review that must come from another family is a fresh full review',{timeout:120000},async t=>{
 const {store,calls,work,script}=await fixture(t);
 await script([[blocking],[]]);
 await work('first attempt\n');
 await reviewer(store,'a',undefined,['Spec']);
 await c.repair(store,'a');
 await work('repaired\n');
 const [first]=await calls();
 await reviewer(store,'a',undefined,['Spec'],{excludeFamilies:[c.family(first.model)]});
 const [,second]=await calls();
 assert.equal(second.continued,false);
 assert.notEqual(c.family(second.model),c.family(first.model));
});
