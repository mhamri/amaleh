import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeRender, visualJudgeModels } from '../scripts/judge.ts';
import { solidPng } from './png-fixture.ts';
import { visualDifference } from '../scripts/design.ts';

const card=(id:string,inputs:string[])=>({id,created:1,context_length:64000,architecture:{input_modalities:inputs},supported_parameters:['tools'],pricing:{prompt:'0.000001',completion:'0.000002'}});
const flash=['z-ai/glm-eye-flash','deepseek/eye-flash','xiaomi/eye-flash','text/blind-flash'];
const catalog=[card('z-ai/glm-eye-flash',['text','image']),card('deepseek/eye-flash',['text','image']),card('xiaomi/eye-flash',['text','image','video']),card('text/blind-flash',['text'])];
type Reply={status?:number;content?:string};
const settings=(flashModels:string[])=>JSON.stringify({flash:flashModels,deep:['moonshotai/kimi-k3'],jev:'~typesafe/jev-latest',providerCooldownMs:300000,providerFailovers:3,launchAttempts:3,idleTimeoutMs:900000,slowModelWindowMs:604800000,reviewerMaxTurns:60});

async function fixture(t:any,replies:Reply[]=[]){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-judge-'));
 const old={models:process.env.AMALEH_MODELS,key:process.env.OPENROUTER_API_KEY};
 t.after(async()=>{for(const [name,value] of [['AMALEH_MODELS',old.models],['OPENROUTER_API_KEY',old.key]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;await rm(dir,{recursive:true,force:true});});
 await writeFile(join(dir,'models.json'),settings(flash));
 process.env.AMALEH_MODELS=join(dir,'models.json');process.env.OPENROUTER_API_KEY='sk-judge-fixture-not-real';
 const reference=join(dir,'design.png'),render=join(dir,'render.png');
 await writeFile(reference,solidPng(40,20,(x)=>x<20?[15,23,42]:[56,189,248]));
 await writeFile(render,solidPng(40,20,(x)=>x<20?[15,23,42]:[245,158,11]));
 const requests:any[]=[];
 const fetcher=(async(url:any,init:any)=>{
  if(String(url).endsWith('/models'))return Response.json({data:catalog});
  const body=JSON.parse(init.body),reply=replies[Math.min(requests.length,replies.length-1)];requests.push(body);
  if(reply.status)return new Response('{}',{status:reply.status});
  return Response.json({model:body.model,choices:[{message:{content:reply.content}}]});
 }) as typeof fetch;
 return {reference,render,requests,fetcher};
}
const report=(differences:object[])=>JSON.stringify({summary:'Compared the card',differences});

test('the judge is an image-capable flash model outside the author family, rotated by the task seed',async t=>{
 const {fetcher}=await fixture(t);
 const glmAuthor=await visualJudgeModels('run/card',`glm`,fetcher);
 assert.equal(glmAuthor.length,2,'at most two judges are tried');
 assert.ok(glmAuthor.every(m=>m!=='z-ai/glm-eye-flash'&&m!=='text/blind-flash'),'neither the author family nor a text-only model judges');
 assert.deepEqual(await visualJudgeModels('run/card','glm',fetcher),glmAuthor,'the same task keeps the same judges across rounds');
 const seeds=new Set(await Promise.all(['run/a','run/b','run/c','run/d','run/e','run/f'].map(async seed=>(await visualJudgeModels(seed,undefined,fetcher))[0])));
 assert.ok(seeds.size>1,'different tasks spread over the eligible judges');
});

test('the judge sends both pictures and the measured facts, and a blocking difference means the build differs',async t=>{
 const {reference,render,requests,fetcher}=await fixture(t,[{content:'```json\n'+report([{area:'chart',expected:'blue bars',actual:'orange bars',severity:'blocking'},{area:'title',expected:'Segoe UI',actual:'Arial',severity:'minor'}])+'\n```'}]);
 const verdict=await judgeRender({reference,render,seed:'run/card',authorFamily:'deepseek'},fetcher);
 assert.equal(verdict.verdict,'differs');
 assert.equal(verdict.differences.length,2);
 assert.equal(verdict.meanDifference,Math.round((Math.abs(56-245)+Math.abs(189-158)+Math.abs(248-11))/6*10)/10);
 const [request]=requests;
 assert.equal(request.temperature,0);
 assert.notEqual(request.model,'deepseek/eye-flash');
 const parts=request.messages[0].content;
 assert.deepEqual(parts.filter((p:any)=>p.type==='image_url').map((p:any)=>p.image_url.url.slice(0,22)),['data:image/png;base64,','data:image/png;base64,']);
 assert.match(parts[0].text,/Design: 40x20 pixels; main colors by area: #0F172A 50\.0%, #38BDF8 50\.0%/);
 assert.match(parts[0].text,/Built work: 40x20 pixels; main colors by area: #0F172A 50\.0%, #F59E0B 50\.0%/);
 assert.ok(parts[0].text.includes(`would say the build is not the design: ${visualDifference.blocking}.\nA difference is minor when it is ${visualDifference.minor}.`),'the judge applies the bar the worker brief states');
});

test('only minor differences mean the build matches the design',async t=>{
 const {reference,render,fetcher}=await fixture(t,[{content:report([{area:'title',expected:'Segoe UI',actual:'Arial',severity:'minor'}])}]);
 assert.equal((await judgeRender({reference,render,seed:'run/card'},fetcher)).verdict,'match');
});

test('a reply without a valid differences list goes to the second judge',async t=>{
 const {reference,render,requests,fetcher}=await fixture(t,[{content:'The pictures look similar.'},{content:report([])}]);
 assert.equal((await judgeRender({reference,render,seed:'run/card'},fetcher)).verdict,'match');
 assert.equal(requests.length,2);
 assert.notEqual(requests[0].model,requests[1].model);
});

test('two judges without a valid differences list are an error',async t=>{
 const {reference,render,requests,fetcher}=await fixture(t,[{content:report([{area:'chart',severity:'severe'}])}]);
 await assert.rejects(()=>judgeRender({reference,render,seed:'run/card'},fetcher),/No visual judge answered: .*without a valid differences array/);
 assert.equal(requests.length,2);
});

test('a funding failure stops the judge at once instead of spending on the next model',async t=>{
 const {reference,render,requests,fetcher}=await fixture(t,[{status:402}]);
 await assert.rejects(()=>judgeRender({reference,render,seed:'run/card'},fetcher),/credits exhausted/);
 assert.equal(requests.length,1);
});

test('a run with no image-capable flash model cannot judge and names the configuration to change',async t=>{
 const {reference,render,fetcher}=await fixture(t);
 await writeFile(process.env.AMALEH_MODELS!,settings(['text/blind-flash','z-ai/glm-eye-flash']));
 await assert.rejects(()=>judgeRender({reference,render,seed:'run/card',authorFamily:'glm'},fetcher),/No flash model in .*models\.json accepts image input outside the worker's family glm/);
});
