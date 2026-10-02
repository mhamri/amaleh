import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelConfig, configPath, isAlias, jevModel } from '../scripts/config.ts';

const valid={flash:['a/one','b/two'],deep:['c/deep'],jev:'typesafe/jev-1.13',providerCooldownMs:300000,providerFailovers:3,launchAttempts:3,idleTimeoutMs:900000,slowModelWindowMs:604800000,reviewerMaxTurns:60};
async function written(t:any,value:unknown){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'models.json');await writeFile(path,typeof value==='string'?value:JSON.stringify(value));
 return path;
}

test('the shipped configuration loads and lists every model explicitly',async()=>{
 const config=await loadModelConfig();
 assert.ok(config.flash.length>=2,'a reviewer needs a model from a family other than the author');
 assert.ok(config.deep.length>=1);
 assert.ok(config.jev.trim());
 assert.ok(config.flash.every(id=>id.includes('/')),'every entry must be an exact OpenRouter model id');
 assert.ok(!config.flash.some(id=>/gemini/i.test(id)),'Google Gemini is excluded on cost');
 assert.ok(!config.flash.some(id=>id.endsWith(':free')),'free tiers are excluded: they cost nothing per token and minutes of wall clock in rate-limit failovers');
 assert.ok(new Set(config.flash.map(id=>id.split('/')[0])).size===config.flash.length,'each flash model must come from a different vendor so one outage cannot block reviewer independence');
 assert.match(configPath(),/models\.json$/);
});

test('an unreadable or malformed configuration names the file and the problem',async t=>{
 const absent=join(await written(t,valid),'..','absent.json'),malformed=await written(t,'{ not json');
 await assert.rejects(()=>loadModelConfig(absent),/Model configuration unreadable at .*absent\.json/);
 await assert.rejects(()=>loadModelConfig(malformed),/is not valid JSON/);
});

test('each field is validated with a message naming the field and the file',async t=>{
 const cases:[unknown,RegExp][]=[
  [{...valid,flash:[]},/flash in .* must be a non-empty array/],
  [{...valid,flash:['a/one','a/one']},/flash in .* repeats a\/one/],
  [{...valid,deep:'c/deep'},/deep in .* must be a non-empty array/],
  [{...valid,jev:''},/jev in .* must be an exact OpenRouter model id/],
  [{...valid,providerFailovers:0},/providerFailovers in .* must be a whole number between 1 and 10/],
  [{...valid,launchAttempts:9},/launchAttempts in .* must be a whole number between 1 and 5/],
  [{...valid,providerCooldownMs:1.5},/providerCooldownMs in .* must be a whole number/],
  [{...valid,idleTimeoutMs:-1},/idleTimeoutMs in .* must be a whole number between 0 and 7200000/],
  [{...valid,slowModelWindowMs:undefined},/slowModelWindowMs in .* must be a whole number between 0 and 2592000000/],
  [{...valid,workerTimeoutMs:1.5},/workerTimeoutMs in .* must be a whole number/],
  [{...valid,workerTimeoutMs:86400001},/workerTimeoutMs in .* must be a whole number between 0 and 86400000/],
  [{...valid,reviewerTimeoutMs:-1},/reviewerTimeoutMs in .* must be a whole number between 0 and 86400000/],
  [{...valid,reviewerMaxTurns:2},/reviewerMaxTurns in .* must be a whole number between 5 and 500/],
  [{...valid,lightReviewLines:-1},/lightReviewLines in .* must be a whole number between 0 and 100000/]];
 for(const [value,message] of cases){const path=await written(t,value);await assert.rejects(()=>loadModelConfig(path),message);}
});

test('the optional wall-clock limits default when absent and accept 0 to disable them',async t=>{
 const defaults=await loadModelConfig(await written(t,valid));
 assert.equal(defaults.workerTimeoutMs,2700000,'a worker call needs a default wall-clock limit');
 assert.equal(defaults.reviewerTimeoutMs,2400000,'a reviewer call needs a default wall-clock limit');
 assert.equal(defaults.lightReviewLines,200,'an existing configuration gets the light review limit');
 const explicit=await loadModelConfig(await written(t,{...valid,workerTimeoutMs:120000,reviewerTimeoutMs:0}));
 assert.equal(explicit.workerTimeoutMs,120000);
 assert.equal(explicit.reviewerTimeoutMs,0,'0 disables the reviewer limit');
});

test('AMALEH_MODELS redirects the configuration and AMALEH_JEV_MODEL still wins for Jev',async t=>{
 const path=await written(t,{...valid,jev:'from/file'});
 const old={models:process.env.AMALEH_MODELS,jev:process.env.AMALEH_JEV_MODEL};
 t.after(()=>{for(const [name,value] of [['AMALEH_MODELS',old.models],['AMALEH_JEV_MODEL',old.jev]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;});
 process.env.AMALEH_MODELS=path;delete process.env.AMALEH_JEV_MODEL;
 assert.equal(configPath(),path);
 assert.deepEqual((await loadModelConfig()).flash,valid.flash);
 assert.equal(await jevModel(),'from/file');
 process.env.AMALEH_JEV_MODEL='override/jev';
 assert.equal(await jevModel(),'override/jev');
});

test('floating aliases are recognised so a resolved concrete model is accepted',()=>{
 for(const id of ['~deepseek/deepseek-flash-latest','~z-ai/glm-flash-latest','~moonshotai/kimi-latest','vendor/model-latest'])assert.equal(isAlias(id),true,id);
 for(const id of ['deepseek/deepseek-v4.1-flash','upstage/solar-pro4','xiaomi/mimo-v2.5','inclusionai/ling-3.0-flash-fin:free'])assert.equal(isAlias(id),false,id);
});
