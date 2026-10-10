import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hostUsage} from '../scripts/host-usage.ts';
const from=Date.parse('2026-10-04T16:00:00.000Z');
const to=Date.parse('2026-10-04T18:00:00.000Z');
const inside='2026-10-04T17:00:00.000Z';
const before='2026-10-04T15:00:00.000Z';
const after='2026-10-04T19:00:00.000Z';
const meta=(cwd:string)=>JSON.stringify({timestamp:before,type:'session_meta',payload:{id:'session',cwd}});
const tokenCount=(timestamp:string,total:number,last:{input:number;cached:number;write?:number;output:number})=>JSON.stringify({timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:total},last_token_usage:{input_tokens:last.input,cached_input_tokens:last.cached,cache_write_input_tokens:last.write??0,output_tokens:last.output,reasoning_output_tokens:0,total_tokens:last.input+last.output}}}});
const toolCall=(timestamp:string,type:string)=>JSON.stringify({timestamp,type:'response_item',payload:{type}});
async function fixture(t:any){
 const root=await mkdtemp(join(tmpdir(),'amaleh-host-usage-'));
 const home=join(root,'codex-home');
 const workspace=join(root,'counteasy');
 const previous=process.env.CODEX_HOME;
 process.env.CODEX_HOME=home;
 t.after(async()=>{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await rm(root,{recursive:true,force:true});});
 const session=async(lines:string[],folder='sessions/2026/10/04',name='rollout.jsonl')=>{await mkdir(join(home,folder),{recursive:true});await writeFile(join(home,folder,name),lines.join('\n')+'\n');};
 return {root,home,workspace,session};
}
test('codex session inside the window is summed field by field',async t=>{
 const {home,workspace,session}=await fixture(t);
 await session([meta(workspace),tokenCount(inside,100,{input:1000,cached:800,write:5,output:50}),tokenCount(inside,300,{input:2000,cached:1500,write:7,output:80})]);
 assert.deepEqual(await hostUsage({kind:'codex'},workspace,from,to),{available:true,source:home,turns:2,toolCalls:0,inputTokens:700,cacheReadTokens:2300,cacheWriteTokens:12,outputTokens:130});
});
test('a duplicate consecutive token_count is counted once and null info is skipped',async t=>{
 const {workspace,session}=await fixture(t);
 const row=tokenCount(inside,100,{input:1000,cached:800,output:50});
 await session([meta(workspace),row,row,JSON.stringify({timestamp:inside,type:'event_msg',payload:{type:'token_count',info:null}}),tokenCount(inside,200,{input:10,cached:0,output:5})]);
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.turns,2);
 assert.equal(usage.inputTokens,210);
 assert.equal(usage.outputTokens,55);
});
test('rows outside the window are ignored',async t=>{
 const {workspace,session}=await fixture(t);
 await session([meta(workspace),tokenCount(before,100,{input:1000,cached:0,output:50}),tokenCount(inside,200,{input:10,cached:0,output:5}),tokenCount(after,300,{input:1000,cached:0,output:50}),toolCall(before,'function_call'),toolCall(after,'function_call')]);
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.turns,1);
 assert.equal(usage.inputTokens,10);
 assert.equal(usage.toolCalls,0);
});
test('a session whose cwd is an unrelated folder is ignored',async t=>{
 const {root,workspace,session}=await fixture(t);
 await session([meta(join(root,'other-project')),tokenCount(inside,100,{input:1000,cached:0,output:50})]);
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.available,true);
 assert.equal(usage.turns,0);
 assert.equal(usage.inputTokens,0);
});
test('a workspace nested inside the session cwd matches',async t=>{
 const {workspace,session}=await fixture(t);
 await session([meta(workspace),tokenCount(inside,100,{input:1000,cached:0,output:50})]);
 const usage:any=await hostUsage({kind:'codex'},join(workspace,'.amaleh','integration','visual-reports'),from,to);
 assert.equal(usage.turns,1);
 assert.equal(usage.outputTokens,50);
});
test('tool calls are counted and archived sessions are read',async t=>{
 const {workspace,session}=await fixture(t);
 await session([meta(workspace),toolCall(inside,'function_call'),toolCall(inside,'custom_tool_call'),toolCall(inside,'local_shell_call'),toolCall(inside,'reasoning'),tokenCount(inside,100,{input:10,cached:0,output:5})]);
 await session([meta(workspace),toolCall(inside,'function_call')],'archived_sessions','archived.jsonl');
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.toolCalls,4);
 assert.equal(usage.turns,1);
});
test('a transcript whose modified time is the session start is still read',async t=>{
 const {home,workspace,session}=await fixture(t);
 await session([meta(workspace),tokenCount(inside,100,{input:10,cached:0,output:5})],'archived_sessions','old.jsonl');
 const started=new Date(before);
 await utimes(join(home,'archived_sessions','old.jsonl'),started,started);
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.turns,1);
});
test('a session that starts after the window is not read',async t=>{
 const {workspace,session}=await fixture(t);
 await session([JSON.stringify({timestamp:after,type:'session_meta',payload:{id:'late',cwd:workspace}}),tokenCount(inside,100,{input:10,cached:0,output:5})]);
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.turns,0);
});
test('a missing codex home reports unavailable and names the home',async t=>{
 const {home,workspace}=await fixture(t);
 const usage:any=await hostUsage({kind:'codex'},workspace,from,to);
 assert.equal(usage.available,false);
 assert.ok(usage.reason.includes(home));
});
test('an unknown host kind still has no reader',async t=>{
 const {workspace}=await fixture(t);
 const usage:any=await hostUsage({kind:'other'},workspace,from,to);
 assert.equal(usage.available,false);
 assert.ok(usage.reason.includes('No transcript reader exists for host kind other'));
});
