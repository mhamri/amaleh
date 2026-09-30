import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { piRun, CallStopped } from '../scripts/adapters.ts';
import { speedSamples, modelSpeed, readSpeedSamples, diagnostics } from '../scripts/telemetry.ts';

const modelsConfig=join(import.meta.dirname,'..','models.json');
async function fixture(t:any,models?:Record<string,unknown>){
 const dir=await mkdtemp(join(tmpdir(),'amaleh-speed-accounting-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const old={key:process.env.OPENROUTER_API_KEY,pi:process.env.AMALEH_PI_ENTRY,node:process.env.AMALEH_NODE,models:process.env.AMALEH_MODELS};
 let configPath=modelsConfig;
 if(models){configPath=join(dir,'models.json');await writeFile(configPath,JSON.stringify({...JSON.parse(await readFile(modelsConfig,'utf8')),...models}));}
 process.env.OPENROUTER_API_KEY='sk-or-fake-speed-accounting-12345';process.env.AMALEH_MODELS=configPath;
 t.after(()=>{for(const [name,value] of [['OPENROUTER_API_KEY',old.key],['AMALEH_PI_ENTRY',old.pi],['AMALEH_NODE',old.node],['AMALEH_MODELS',old.models]])if(value===undefined)delete process.env[name!];else process.env[name!]=value;});
 return dir;
}
async function fakePi(t:any,source:string,models?:Record<string,unknown>){
 const dir=await fixture(t,models),entry=join(dir,'fake-pi.ts');
 await writeFile(entry,source);process.env.AMALEH_PI_ENTRY=entry;process.env.AMALEH_NODE=process.execPath;
 return {dir,input:{workspace:dir,model:'test/model',prompt:'fixture',sessionDir:join(dir,'.sessions'),diagnosticRoot:join(dir,'.diagnostics'),speedDir:dir}};
}
const refused={type:'message_end',message:{role:'assistant',model:'test/model',content:[{type:'text',text:''}],stopReason:'error',errorMessage:'Model refused the request',usage:{input:10,output:7}}};

const operation=(outcome:string,elapsedMs:number,outputTokens:number)=>({id:outcome+elapsedMs,operation:'pi',started:'2026-09-24T19:00:00.000Z',elapsedMs,outcome,metadata:{model:'test/model',readOnly:false},events:[{stage:'usage',data:{outputTokens},elapsedMs:1}]});

test('a failed pi call counts toward model speed, with its failure named',()=>{
 const samples=speedSamples([operation('success',60000,100),operation('failed',180000,50)] as any);
 assert.equal(samples.length,2,'a failed call spent real time and must be sampled');
 assert.equal(samples.filter((s:any)=>s.failed===true).length,1);
 const [speed]=modelSpeed(samples) as any[];
 assert.equal(speed.calls,2);
 assert.equal(speed.failures,1);
 assert.equal(speed.averageMinutes,2,'the failed call time is part of the average');
});

test('piRun appends a failed speed sample when the call fails',async t=>{
 const {dir,input}=await fakePi(t,`process.stdout.write(${JSON.stringify(JSON.stringify(refused)+'\n'+JSON.stringify({type:'agent_end'})+'\n')});`);
 await assert.rejects(()=>piRun(input),/Model refused the request/);
 const samples=await readSpeedSamples(dir) as any[];
 assert.equal(samples.length,1);
 assert.equal(samples[0].failed,true);
 assert.equal(samples[0].model,'test/model');
 assert.equal(samples[0].role,'worker');
});

test('a reviewer call is stopped by its own wall-clock limit and sampled as a reviewer failure',async t=>{
 const chatter=JSON.stringify({type:'tool_execution_start',toolName:'read',args:{path:'x'}})+'\n';
 const {dir,input}=await fakePi(t,`setInterval(()=>process.stdout.write(${JSON.stringify(chatter)}),200);`,{reviewerTimeoutMs:1500});
 await assert.rejects(()=>piRun({...input,readOnly:true}),/time limit/i);
 const report=await diagnostics(input.diagnosticRoot);
 assert.ok(report.operations[0].events.some((e:any)=>e.stage==='call-timeout'),'the trace must name the wall-clock timeout');
 const samples=await readSpeedSamples(dir) as any[];
 assert.equal(samples.length,1);
 assert.equal(samples[0].failed,true);
 assert.equal(samples[0].role,'reviewer');
});

test('a worker call that keeps talking past the wall-clock limit is stopped and recorded as failed',async t=>{
 const chatter=JSON.stringify({type:'tool_execution_start',toolName:'read',args:{path:'x'}})+'\n';
 const {dir,input}=await fakePi(t,`setInterval(()=>process.stdout.write(${JSON.stringify(chatter)}),200);`,{workerTimeoutMs:1500});
 const started=Date.now();
 await assert.rejects(()=>piRun(input),(error:unknown)=>error instanceof CallStopped&&error.stage==='call-timeout'&&/time limit/i.test(error.message));
 assert.ok(Date.now()-started<15000,'the limit must stop the call, not the idle timer');
 const report=await diagnostics(input.diagnosticRoot);
 assert.equal(report.operations[0].events.filter((e:any)=>e.stage==='attempt').length,1,'a timed-out call is not retried as a transient provider failure');
 const samples=await readSpeedSamples(dir) as any[];
 assert.equal(samples.length,1);
 assert.equal(samples[0].failed,true);
});
