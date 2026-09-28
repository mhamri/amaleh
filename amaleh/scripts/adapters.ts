import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { join, delimiter, dirname, basename, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { invariant, execute, Store, event, claim, result, review, packet, fingerprint, taskOf, family, acquireActivity, releaseActivity, activitySpawned, reviewObligations, reopenReasons } from './core.ts';
import type { Decision, Command, Guidance } from './core.ts';
import { selectModel, consumeRoute } from './routing.ts';
import type { RoutingRequest } from './routing.ts';
import { trace, registerSecret, sanitize, recordSpeed } from './telemetry.ts';
import { jsRuntime } from './runtime.ts';
import { jevModel, isAlias, loadModelConfig } from './config.ts';

export async function piCommand():Promise<Command>{
 const runtime=await jsRuntime();
 if(process.env.AMALEH_PI_ENTRY)return {command:runtime,args:[process.env.AMALEH_PI_ENTRY]};
 for(const root of (process.env.PATH??'').split(delimiter))for(const candidate of [join(root,'node_modules','@earendil-works','pi-coding-agent','dist','bundle','cli.js'),join(root,'..','lib','node_modules','@earendil-works','pi-coding-agent','dist','bundle','cli.js')]){try{await access(candidate);return {command:runtime,args:[candidate]};}catch{}}
 if(process.platform!=='win32')return {command:'pi',args:[]};
 throw new Error('Set AMALEH_PI_ENTRY to the installed pi JavaScript entrypoint; no shell shim is executed.');
}
export async function credential():Promise<string>{
 if(process.env.OPENROUTER_API_KEY){registerSecret(process.env.OPENROUTER_API_KEY);return process.env.OPENROUTER_API_KEY;}
 const path=join(process.env.PI_CODING_AGENT_DIR??join(homedir(),'.pi','agent'),'auth.json');
 const auth=JSON.parse(await readFile(path,'utf8')).openrouter;
 // pi OpenRouter OAuth stores the gateway key in access. Do not copy it into run files or command arguments.
 const key=auth?.type==='api_key'?auth.key:auth?.type==='oauth'?auth.access:undefined;
 invariant(typeof key==='string'&&key.length>8,'OpenRouter credential unavailable; configure pi or OPENROUTER_API_KEY');
 if(auth.type==='oauth'&&auth.expires&&auth.expires<Date.now())throw new Error('pi OpenRouter credential expired; refresh it through pi auth before resuming');
 registerSecret(key);return key;
}
export async function requestJson(url:string,body?:unknown,fetcher:typeof fetch=fetch,diagnosticRoot?:string,options:{attempts?:number;timeoutMs?:number}={}){
 const attempts=options.attempts??3;invariant(Number.isInteger(attempts)&&attempts>=1&&attempts<=3,'Invalid request attempt count');
 const telemetry=await trace(diagnosticRoot,'openrouter',{endpoint:new URL(url).pathname,model:(body as any)?.model});
 try{const key=await credential();
 for(let attempt=0;attempt<attempts;attempt++){
  let response:Response;
  await telemetry.write('attempt',{attempt:attempt+1});
  try{response=await fetcher(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(options.timeoutMs??60000)});}catch(error){await telemetry.write('transport-error',{attempt:attempt+1,message:(error as Error).message});if(attempt===attempts-1)throw new Error('OpenRouter unreachable after bounded retries');await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
  await telemetry.write('response',{status:response.status,requestId:response.headers.get('x-request-id')});
  if(response.ok){const value=await response.json();if(value.usage)await telemetry.write('usage',{inputTokens:value.usage.input_tokens,outputTokens:value.usage.output_tokens,cost:value.usage.cost,costSource:'openrouter-response'});await telemetry.end('success',{model:value.model,provider:value.provider,requestId:value.id});return value;}
  if((response.status===429||response.status>=500)&&attempt<attempts-1){const seconds=Number(response.headers.get('retry-after'));await new Promise(r=>setTimeout(r,Math.min(10000,Number.isFinite(seconds)&&seconds>0?seconds*1000:1000*(attempt+1))));continue;}
  throw new Error(`OpenRouter HTTP ${response.status}${response.status===402?': credits exhausted; top up and resume':''}`);
 }
 throw new Error('OpenRouter request failed');
 }catch(error){await telemetry.end('failed',{message:(error as Error).message});throw error;}
}
export function choiceAnswerFor(raw:any,key:string,criteria:Record<string,string>,threshold=.7){const a=raw?.answers?.[key];invariant(a?.type==='choice'&&typeof a.choice==='string'&&Object.hasOwn(criteria,a.choice),'Invalid Jev choice');invariant(Number.isFinite(a.confidence)&&a.confidence>=0&&a.confidence<=1,'Invalid Jev confidence');invariant(a.probabilities&&Object.keys(a.probabilities).length===Object.keys(criteria).length&&Object.keys(criteria).every(k=>Number.isFinite(a.probabilities[k])&&a.probabilities[k]>=0&&a.probabilities[k]<=1),'Invalid Jev probabilities');invariant(Math.abs(Object.values(a.probabilities as Record<string,number>).reduce((a,b)=>a+b,0)-1)<.02,'Invalid Jev probability sum');return {choice:a.confidence>=threshold?a.choice:undefined,confidence:a.confidence,source:String(raw.model??'OpenRouter Jev')};}
export function choiceAnswer(raw:any,criteria:Record<string,string>,threshold=.7){return choiceAnswerFor(raw,'selection',criteria,threshold);}
// One HTTP round trip settles many independent questions; use instead of repeated decide calls.
export async function decideBatch(store:Store,input:{decisions:Omit<Decision,'revision'>[]},fetcher?:typeof fetch){
 invariant(Array.isArray(input.decisions)&&input.decisions.length>=1&&input.decisions.length<=16,'One to sixteen decisions per batch');
 for(const d of input.decisions)invariant(d.id&&d.question&&d.criteria&&Object.keys(d.criteria).length>=2,`Decision ${d.id??'?'} needs ID, question and at least two options`);
 const before=await store.load();for(const d of input.decisions)invariant(!before.decisions.some(x=>x.id===d.id),`Decision ID already exists: ${d.id}`);
 const raw=await requestJson('https://openrouter.ai/api/alpha/decisions',{model:await jevModel(),state:{batch:input.decisions.map(d=>({id:d.id,state:d.state}))},questions:Object.fromEntries(input.decisions.map(d=>[d.id,{type:'choice',instructions:d.question,criteria:d.criteria}]))},fetcher,store.root);
 const artifact=await store.artifact(raw);
 const answers=input.decisions.map(d=>{let a:{choice?:string;confidence?:number;source:string;reason?:string};try{a=choiceAnswerFor(raw,d.id,d.criteria);}catch(e){a={source:'invalid-jev-response',reason:(e as Error).message};}return {...a,id:d.id};});
 await store.transaction(s=>{invariant(s.revision===before.revision,'State changed during batch decision; request fresh decisions');for(const d of input.decisions){const {id:_omit,...a}=answers.find(x=>x.id===d.id)!;s.decisions.push({...d,purpose:d.purpose??'workflow',revision:before.revision,...a,artifact});event(s,'decision',{id:d.id,purpose:d.purpose??'workflow',...a,artifact,batch:input.decisions.length});}});
 return answers;
}
export async function decide(store:Store,input:Omit<Decision,'revision'>,fetcher?:typeof fetch){
 invariant(input.id&&input.question&&input.criteria&&Object.keys(input.criteria).length>=2,'Decision needs ID, question and at least two options');
 const before=await store.load();invariant(!before.decisions.some(d=>d.id===input.id),'Decision ID already exists');
 const raw=await requestJson('https://openrouter.ai/api/alpha/decisions',{model:await jevModel(),state:input.state,questions:{selection:{type:'choice',instructions:input.question,criteria:input.criteria}}},fetcher,store.root);
 const artifact=await store.artifact(raw);let answer:{choice?:string;confidence?:number;source:string;reason?:string};try{answer=choiceAnswer(raw,input.criteria);}catch(e){answer={source:'invalid-jev-response',reason:(e as Error).message};}
 await store.transaction(s=>{invariant(s.revision===before.revision,'State changed during decision; request a fresh decision');s.decisions.push({...input,purpose:input.purpose??'workflow',revision:before.revision,...answer,artifact});event(s,'decision',{id:input.id,purpose:input.purpose??'workflow',...answer,artifact});});return answer;
}
export async function hostDecision(store:Store,id:string,choice:string,reason:string){await store.transaction(s=>{const d=s.decisions.find(d=>d.id===id);invariant(d&&!d.choice&&Object.hasOwn(d.criteria,choice)&&reason,'Pending decision, eligible option and reason required');d.choice=choice;d.source='host:'+s.host.model;d.reason=reason;event(s,'host-decision',{id,choice,reason});});}
export async function catalog(store?:Store,fetcher:typeof fetch=fetch){const data=await requestJson('https://openrouter.ai/api/v1/models',undefined,fetcher,store?.root);invariant(Array.isArray(data.data),'Invalid OpenRouter catalog');const selected=data.data.filter((m:any)=>typeof m.id==='string').map((m:any)=>({id:m.id,created:m.created,context:m.context_length,modalities:m.architecture?.input_modalities,parameters:m.supported_parameters,pricing:m.pricing,description:m.description})).sort((a:any,b:any)=>b.created-a.created);const record={verifiedAt:new Date().toISOString(),source:'https://openrouter.ai/api/v1/models',models:selected};if(store)await store.artifact(record);return record;}

// Retrying a funding or authorization failure burns money and never succeeds, so
// those are matched first and never treated as transient.
const settledProvider=/credits? (are )?exhausted|requires more credits|insufficient (credit|balance|fund)|top ?up|quota exceeded|billing|unauthorized|invalid api key|lacks access|no endpoints found/i;
const codedFailure=/\b(408|409|429|500|502|503|504|529)\b/;
const transientWording=/rate.?limit|temporarily|overload|unavailable|timed? ?out|Provider returned error|Internal Server Error/i;
const transientWithoutCode=/network connection lost|connection (reset|closed)|socket hang ?up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|retry shortly|try again (shortly|later)|could not verify available credits|provider returned an empty response|stream ended without finish_reason|model stopped before completing the response/i;
export const transientProvider=(message:string)=>!settledProvider.test(message)&&((codedFailure.test(message)&&transientWording.test(message))||transientWithoutCode.test(message));
export const settledProviderFailure=(message:string)=>settledProvider.test(message);
const guardedWriteTools=new Set(['edit','write']),commandTools=new Set(['bash','powershell']);
const debuggerWaitFlag=/^(--inspect-(?:brk|wait))(?:=.*)?$/;
const jsRuntimes=new Set(['node','bun','deno','tsx']),launchers=new Set(['npx','bunx','exec','time','call']);
const unquote=(token:string)=>token.replace(/^(['"])(.*)\1$/,'$2');
const executableName=(token:string)=>unquote(token).split(/[\\/]/).at(-1)!.toLowerCase().replace(/\.(exe|cmd)$/,'');
const shellTokens=(text:string)=>text.match(/"[^"]*"|'[^']*'|\S+/g)??[];
const waitFlagAmong=(tokens:string[])=>tokens.map(t=>unquote(t).match(debuggerWaitFlag)?.[1]).find(Boolean);
// A search or an echo that merely mentions the flag must not stop the worker, so a
// flag counts only as an argument of a JavaScript runtime that the command segment
// launches, or inside a NODE_OPTIONS assignment, which every node child inherits.
export function debuggerWait(command:unknown){
 if(typeof command!=='string')return undefined;
 for(const segment of command.split(/&&|\|\||[;&|\n]/)){
  for(const [,value] of segment.matchAll(/NODE_OPTIONS\s*=\s*("[^"]*"|'[^']*'|\S+)/g)){const flag=waitFlagAmong(shellTokens(unquote(value)));if(flag)return flag;}
  const tokens=shellTokens(segment).filter(t=>!/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)&&!/^\$env:/i.test(t));
  let at=0;while(at<tokens.length&&launchers.has(executableName(tokens[at])))at++;
  if(at<tokens.length&&jsRuntimes.has(executableName(tokens[at]))){const flag=waitFlagAmong(tokens.slice(at+1));if(flag)return flag;}
 }
 return undefined;
}
const writePathArg=(args:unknown)=>{if(!args||typeof args!=='object')return undefined;const a=args as Record<string,unknown>;for(const key of ['path','file_path','filePath'])if(typeof a[key]==='string')return a[key] as string;return undefined;};
const escapedTarget=(workspace:string,path:string)=>{const full=resolve(workspace,path),rel=relative(workspace,full);return rel.startsWith('..')||isAbsolute(rel)?full:undefined;};
export class WorkspaceEscape extends Error{readonly paths:string[];constructor(paths:string[]){super(`Worker wrote outside the task workspace: ${paths.join(', ')}`);this.name='WorkspaceEscape';this.paths=paths;}}
export const resolveWrites=(workspace:string,paths:(string|undefined)[])=>{const root=resolve(workspace),writes:string[]=[],outside:string[]=[];for(const p of paths){if(typeof p!=='string'||!p.trim())continue;const full=resolve(root,p);writes.push(full);if(escapedTarget(root,p))outside.push(full);}return {paths:writes,outside};};
export type CallUsage={at:string;ms:number;outputTokens:number};
const recordCallSpeed=(speedDir:string,model:string,role:'worker'|'reviewer',usage:CallUsage,failed=false)=>recordSpeed(speedDir,{...usage,model,role,...(failed?{failed:true}:{})}).catch(()=>{});
export async function piRun(input:{workspace:string;model:string;prompt:string;sessionDir:string;continueSession?:boolean;readOnly?:boolean;diagnosticRoot?:string;speedDir?:string;speedCarry?:CallUsage;deferSpeedOnSuccess?:boolean;onSpawn?:(pid:number)=>Promise<void>;attempts?:number;idleTimeoutMs?:number;maxTurns?:number}){
 const telemetry=await trace(input.diagnosticRoot,'pi',{model:input.model,workspace:input.workspace,readOnly:!!input.readOnly,sessionDir:input.sessionDir});
 const started=Date.now(),role=input.readOnly?'reviewer' as const:'worker' as const;let outputTokens=0;
 const usageSoFar=():CallUsage=>({at:input.speedCarry?.at??new Date(started).toISOString(),ms:(input.speedCarry?.ms??0)+Date.now()-started,outputTokens:(input.speedCarry?.outputTokens??0)+outputTokens});
 try{
  const config=await loadModelConfig();
  const attempts=input.attempts??config.launchAttempts;
  const idleTimeoutMs=input.idleTimeoutMs??config.idleTimeoutMs;
  const callTimeoutMs=input.readOnly?config.reviewerTimeoutMs:config.workerTimeoutMs;
  invariant(Number.isInteger(attempts)&&attempts>=1&&attempts<=5,'Invalid pi attempt count');
  invariant(input.prompt.length<=promptLimit,`Prompt is ${input.prompt.length} characters; the command line cannot carry more than ${promptLimit}. Hand large material to the model as a file path it reads, rather than inlining it.`);
  const pi=await piCommand();await mkdir(input.sessionDir,{recursive:true});const key=await credential();
  const continuePrompt='Your previous reply was cut off by the output length limit. Continue the task from where you stopped and bring it to completion; end with the final answer exactly as the original prompt asked.';
  const launch=(prompt:string,continueSession:boolean)=>new Promise<{events:any[];text:string;model:string;code:number;stopReason:string;writes:{paths:string[];outside:string[]}}>((done,fail)=>{
   const args=[...pi.args,'--mode','json','--print',...(continueSession?['--continue']:[]),'--provider','openrouter','--model',input.model,'--session-dir',input.sessionDir,'--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--offline','--tools',input.readOnly?'read,grep,find,ls':'read,grep,find,ls,edit,write,bash,powershell','--',prompt];
   // Synchronous spawn errors reject this ordinary Promise executor; no async-executor hang.
   const child=spawn(pi.command,args,{cwd:input.workspace,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,OPENROUTER_API_KEY:key,PI_TELEMETRY:'0'}});
   let buffer='',stderr='',events:any[]=[],text='',actual='',protocolError='',providerError='',ended=false,turns=0,stopReason='';
   const writeArgs:(string|undefined)[]=[];
   let spawnError:Error|undefined;
   let writes=Promise.resolve();const record=(stage:string,data:unknown)=>{writes=writes.then(()=>telemetry.write(stage,data));writes.catch(()=>child.kill());};
   let stopped=false;
   const stop=(message:string,stage:string,data:Record<string,unknown>)=>{if(stopped)return;stopped=true;providerError=message;record(stage,{...data,pid:child.pid});killTree(child);};
   const escapedPaths=new Set<string>();
   let escapeError:WorkspaceEscape|undefined;
   const parse=(line:string)=>{
    if(!line.trim())return;
    let item:any;try{item=JSON.parse(line);}catch{if(escapeError)return;protocolError='pi emitted malformed JSONL';record('protocol-error',{bytes:line.length});return;}
    if(!item||typeof item.type!=='string'){if(escapeError)return;protocolError='pi event lacks a type';return;}
    if(item.type==='tool_execution_start'&&guardedWriteTools.has(item.toolName)){
     const path=writePathArg(item.args);
     writeArgs.push(path);
     const target=path?escapedTarget(input.workspace,path):undefined;
     if(target){escapedPaths.add(target);if(!escapeError){record('workspace-escape',{path:target,pid:child.pid});killTree(child);}escapeError=new WorkspaceEscape([...escapedPaths]);}
    }
    if(escapeError)return;
    if(item.type==='tool_execution_start'&&commandTools.has(item.toolName)){
     const flag=debuggerWait((item.args as {command?:unknown}|undefined)?.command);
     if(flag)stop(`The worker ran a command with ${flag}, which waits for a debugger to attach and never ends on its own, so the call was stopped at once. Inspect diagnostic trace ${telemetry.id}.`,'debugger-wait',{flag});
    }
    if(!['message_update','tool_execution_update'].includes(item.type))events.push(item);
    if(item.type==='agent_end')ended=true;
    if(['agent_start','agent_end','tool_execution_start','tool_execution_end'].includes(item.type))record('progress',{type:item.type,tool:item.toolName,isError:item.isError});
    if(item.type==='message_end'&&item.message?.role==='assistant'){
     if(!Array.isArray(item.message.content)||item.message.content.some((c:any)=>!c||typeof c.type!=='string'||(c.type==='text'&&typeof c.text!=='string'))||typeof item.message.model!=='string'){protocolError='pi assistant event has invalid model/content shape';record('protocol-error',{reason:protocolError});return;}
     actual=item.message.model??actual;text=(item.message.content??[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
     if(typeof item.message.stopReason==='string')stopReason=item.message.stopReason;
     if(!stopped&&(['error','aborted'].includes(item.message.stopReason)||item.message.errorMessage))providerError=String(item.message.errorMessage??`Assistant stopped: ${item.message.stopReason}`);
     const usage=item.message.usage;if(usage)outputTokens+=Number(usage.output)||0;if(usage)record('usage',{inputTokens:usage.input,outputTokens:usage.output,cacheRead:usage.cacheRead,cacheWrite:usage.cacheWrite,cost:usage.cost?.total,costSource:'pi-estimate',model:actual});
     turns++;
     if(input.maxTurns&&turns===input.maxTurns&&!ended&&item.message.stopReason==='toolUse')stop(`Stopped after ${turns} turns, the limit for this call, without a final answer. Inspect diagnostic trace ${telemetry.id}.`,'turn-limit',{turns});
    }
   };
   child.stdout.on('data',data=>{buffer+=data;let newline;while((newline=buffer.indexOf('\n'))>=0){parse(buffer.slice(0,newline).replace(/\r$/,''));buffer=buffer.slice(newline+1);}});
   child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4096);});
   const ownership=Promise.resolve().then(async()=>{if(child.pid){record('spawned',{pid:child.pid});await input.onSpawn?.(child.pid);}});
   ownership.catch(error=>{providerError='Ownership registration failed: '+(error as Error).message;child.kill();});
   let lastOutput=Date.now(),idleTimer:ReturnType<typeof setInterval>|undefined;
   const seen=()=>{lastOutput=Date.now();};
   child.stdout.on('data',seen);child.stderr.on('data',seen);
   if(idleTimeoutMs>0){
    idleTimer=setInterval(()=>{
     const idleMs=Date.now()-lastOutput;
     if(idleMs<idleTimeoutMs)return;
     clearInterval(idleTimer);
     stop(`No output for ${Math.round(idleMs/1000)}s; a child command is hung. Inspect diagnostic trace ${telemetry.id} for the last tool it started.`,'idle-timeout',{idleMs});
    },Math.min(30000,idleTimeoutMs));
    idleTimer.unref?.();
   }
   let callTimer:ReturnType<typeof setTimeout>|undefined;
   if(callTimeoutMs>0){
    callTimer=setTimeout(()=>{
     stop(`pi call exceeded the wall-clock time limit of ${Math.round(callTimeoutMs/1000)}s and was stopped; inspect diagnostic trace ${telemetry.id}.`,'call-timeout',{timeoutMs:callTimeoutMs});
    },callTimeoutMs);
    callTimer.unref?.();
   }
   child.on('error',error=>{spawnError=error;});
   child.on('close',(code,signal)=>{clearInterval(idleTimer);clearTimeout(callTimer);void (async()=>{
    if(buffer.trim())parse(buffer.replace(/\r$/,''));
    await ownership;await writes;
    await telemetry.write('process-exit',{code,signal,stderr,protocolError,providerError,ended,actualModel:actual});
    if(spawnError)throw spawnError;
    invariant(!protocolError,protocolError);
    if(escapeError)throw escapeError;
    invariant(!providerError,String(sanitize(providerError)));
    invariant(code===0&&ended&&actual,`pi incomplete: exit ${code}, agent_end=${ended}; inspect diagnostic trace ${telemetry.id}`);
    invariant(!input.readOnly||!!text,`pi returned no final text for a reviewer call, whose JSON report is the reply; inspect diagnostic trace ${telemetry.id}`);
    invariant(actual===input.model||(isAlias(input.model)&&family(actual)===family(input.model)),`pi resolved a different model (${actual}); update the task route explicitly`);
    done({events,text,model:actual,code:0,stopReason,writes:resolveWrites(input.workspace,writeArgs)});
   })().catch(fail);});
  });
  const run=async(prompt:string,continueSession:boolean)=>{
   for(let attempt=1;;attempt++){
    await telemetry.write('attempt',{attempt,of:attempts});
    try{return await launch(prompt,continueSession);}
    catch(error){
     const message=(error as Error).message;
     if(attempt>=attempts||!transientProvider(message))throw error;
     await telemetry.write('transient-provider',{attempt,message});
     await new Promise(r=>setTimeout(r,1000*attempt));
    }
   }
  };
  let output=await run(input.prompt,!!input.continueSession);
  if(!input.readOnly&&output.stopReason==='length'){
   await telemetry.write('length-continue',{sessionDir:input.sessionDir});
   output=await run(continuePrompt,true);
   if(output.stopReason==='length')await telemetry.write('length-partial',{message:'The continuation stopped on the length limit too; the partial reply goes to checks and review'});
  }
  await telemetry.end('success',{model:output.model});
  const usage=usageSoFar();
  if(input.speedDir&&!input.deferSpeedOnSuccess)await recordCallSpeed(input.speedDir,input.model,role,usage);
  return {...output,usage};
 }catch(error){await telemetry.end('failed',{message:(error as Error).message});if(input.speedDir)await recordCallSpeed(input.speedDir,input.model,role,usageSoFar(),true);throw error;}
}
const guidanceRoots=()=>[join(homedir(),'.claude','skills'),join(process.env.CODEX_HOME??join(homedir(),'.codex'),'skills')];
async function guidanceSource(workspace:string,entry:string){
 invariant(typeof entry==='string'&&entry.trim(),'Guidance entries must be non-empty strings');
 const asPath=/[\\/]/.test(entry)||entry.endsWith('.md');
 const candidates=asPath?[isAbsolute(entry)?entry:join(workspace,entry)]:guidanceRoots().map(root=>join(root,entry,'SKILL.md'));
 for(const candidate of candidates){try{return {path:candidate,body:await readFile(candidate,'utf8')};}catch{}}
 throw new Error(`Guidance "${entry}" was not readable; searched ${candidates.join(' and ')}`);
}
export async function guidanceBlock(workspace:string,guidance:Guidance,limit=32000){
 const sections:string[]=[];
 for(const [label,entries] of [['SKILL',guidance.skills??[]],['REFERENCE',guidance.references??[]]] as const){
  invariant(Array.isArray(entries),`Task ${label.toLowerCase()}s must be an array of names or paths`);
  for(const entry of entries){const {path,body}=await guidanceSource(workspace,entry);
   sections.push(`--- ${label}: ${entry} (${path}) ---\n${body.length>limit?body.slice(0,limit)+`\n[truncated at ${limit} characters]`:body}`);}
 }
 return sections.length?`\nApply the guidance below as if it were loaded into your own instructions; it is binding for this task.\n${sections.join('\n')}\n`:'';
}
// The prompt is an argv element, so a large skill inlined into it overflows the
// operating system's command-line limit. Hand the worker a path instead: the file
// lives outside the task workspace so it cannot alter the verification fingerprint.
export async function handoffFile(store:Store,id:string,name:string,body:string){
 const dir=join(store.root,'sessions',id);await mkdir(dir,{recursive:true});
 const path=join(dir,name);await writeFile(path,body);
 return path;
}
export type WorkerPromptInput={workspace:string;briefPath:string;artifacts:string;runtime:string;jev:string;question:string;runWorkspace:string;runId:string;taskId:string;nested?:boolean};
export const nestedRunCheckout=(runWorkspace:string,workspace:string)=>{const inside=relative(resolve(runWorkspace),resolve(workspace));return inside!==''&&!inside.startsWith('..')&&!isAbsolute(inside);};
export const workerPrompt=({workspace,briefPath,artifacts,runtime,jev,question,runWorkspace,runId,taskId,nested}:WorkerPromptInput)=>`You are an Amaleh worker owning this task end to end inside the task workspace "${workspace}". Do not invoke other skills or delegate. Do not add hypothetical features.
Every edit and write must stay under "${workspace}".
${nested?`The run's main checkout at "${runWorkspace}" contains this task workspace, so everything in it outside "${workspace}" is read-only: read it, never edit it or copy it in. The brief at "${briefPath}" and the run's artifacts at "${artifacts}" sit outside this workspace as read-only run records kept under that main checkout: read them, never edit them or copy them into your work. The Jev helper at "${jev}" and the contract question helper at "${question}" sit outside it and are read-only: read them, never edit or copy them in.`:`The brief at "${briefPath}", the run's artifacts at "${artifacts}", the Jev helper at "${jev}", the contract question helper at "${question}" and the run's main checkout at "${runWorkspace}" sit outside it and are read-only: read them, never edit or copy them in.`}
Your brief, the run context and any binding guidance are in "${briefPath}". Read that file in full before you touch anything, and follow it as part of your instructions.
When you face an uncertain semantic choice inside this task (approach, trade-off, interpretation), consult Jev instead of guessing or stalling: "${runtime}" "${jev}" "${runWorkspace}" ${runId} ${taskId} "<question>" "<optionA>|<optionB>|...". Follow its choice; on low confidence pick the safest option, record why, and continue.
Jev chooses between options inside the task contract; it cannot repair the contract. When the contract itself is wrong, do not bend the work to fit it: a registered check that cannot pass for a reason outside this task (for example it compares text the platform rewrites), criteria that contradict each other, or vendor code you would have to write without a source. Raise a contract question instead: "${runtime}" "${question}" "${runWorkspace}" ${runId} ${taskId} "<what is wrong, with the evidence you observed>" [check id]. Then stop working on that part and finish your run; the coordinator answers before any more work on this task.
Never write vendor code or setup for a third-party service from memory: an embed or tag snippet, the argument order of a vendor call, the steps in a vendor console. Copy it from a file in the workspace or in this task's references, and name that file in your result. When no such file exists, raise a contract question.
Every command you run must end on its own: never start a debugger that waits for a client (--inspect-brk, --inspect-wait), a watch mode or an interactive prompt, and stop any server you start before the command returns. In bash, discard output with /dev/null; NUL creates a file.
Return actual changed artifacts, checks and unresolved issues.`;
export async function worker(store:Store,id:string,input:{workspace:string;model?:string;brief?:string;routing?:RoutingRequest}&Guidance){
 const route=await selectModel(store,id,'worker',input.workspace,input.routing);if(route.action!=='launch')return route;
 invariant(!input.model||input.model===route.model,'Explicit model disagrees with recorded route; omit model for automatic selection');
 const model=route.model;
 const workspace=await realpath(input.workspace);
 const s=await store.load(),t=taskOf(s,id);const context=await packet(store,id);
 const scripts=dirname(fileURLToPath(import.meta.url)),runId=basename(store.root),runtime=await jsRuntime();
 const brief=input.brief??'Own this task end to end: satisfy every criterion and make the registered checks pass, stay within the allowed scope and resources, and do not add hypothetical features.';
 const guidance=await guidanceBlock(t.workspace??input.workspace,{skills:input.skills??t.skills,references:input.references??t.references});
 const reopened=reopenReasons(s,id);
 const briefPath=await handoffFile(store,id,'brief.md',[`# Task ${id}\n\n## Your brief\n${brief}`,
  reopened.length?`## Why this task was reopened\nIt was accepted before and then sent back. Fix each defect below and keep the rest of the accepted work as it is; a fresh reviewer verifies each one against the actual artifact.\n${reopened.map(r=>`- ${r}`).join('\n')}`:'',
  `## Task and run context\n\`\`\`json\n${JSON.stringify(context,null,1)}\n\`\`\``,guidance].filter(Boolean).join('\n\n'));
 const prompt=workerPrompt({workspace,briefPath,artifacts:join(store.root,'artifacts'),runtime,jev:join(scripts,'jev.ts'),question:join(scripts,'question.ts'),runWorkspace:s.workspace,runId,taskId:id,nested:nestedRunCheckout(s.workspace,workspace)});
 await claim(store,id,{...input,workspace,model,pid:process.pid,routeDecisionId:route.decisionId});try{const out=await piRun({...input,workspace,model,prompt,diagnosticRoot:store.root,speedDir:store.amalehDir,sessionDir:join(store.root,'sessions',id),onSpawn:async pid=>{await store.transaction(s=>{taskOf(s,id).owner!.pid=pid;});}});await result(store,id,out);return {artifact:taskOf(await store.load(),id).output};}catch(e){await store.transaction(s=>{const t=taskOf(s,id);t.status='blocked';t.owner=undefined;t.blocked=(e as Error).message;event(s,'worker-blocked',{id,reason:t.blocked});if(transientProvider(t.blocked))event(s,'provider-unavailable',{model,family:family(model),taskId:id,purpose:'worker'});});throw e;}
}
export const diffLimit=400000;
const receiptTailLimit=3000;
async function git(args:string[],cwd:string){try{const r=await execute({command:'git',args},cwd);return r.code===0?r.stdout:undefined;}catch{return undefined;}}
// The task checkout forks from the run's main checkout, so their merge base is
// where this task's own changes begin, including after an earlier integration.
export async function taskDiff(mainWorkspace:string,workspace:string){
 const main=(await git(['rev-parse','HEAD'],mainWorkspace))?.trim();
 const base=(main&&(await git(['merge-base','HEAD',main],workspace))?.trim())||(await git(['rev-parse','HEAD'],workspace))?.trim();
 if(!base)return undefined;
 const [stat,patch,names,untracked]=await Promise.all([git(['diff','--relative','--stat',base],workspace),git(['diff','--relative',base],workspace),git(['diff','--relative','--name-only',base],workspace),git(['ls-files','--others','--exclude-standard'],workspace)]);
 if(patch===undefined)return undefined;
 return {base,stat:stat?.trim()??'',paths:(names??'').split(/\r?\n/).filter(Boolean),untracked:(untracked??'').split(/\r?\n/).filter(Boolean),patch:patch.length>diffLimit?patch.slice(0,diffLimit)+`\n[diff truncated at ${diffLimit} characters; read the remaining changed files named in stat directly]`:patch};
}
async function receiptTail(store:Store,artifact:string){
 try{const r=JSON.parse(await store.readArtifact(artifact));const tail=(text:unknown)=>String(text??'').slice(-receiptTailLimit);return {stdout:tail(r.stdout),stderr:tail(r.stderr)};}catch{return undefined;}
}
// Factual projection: never forward author output, verdicts or decision rationale.
export async function reviewPacket(store:Store,id:string,lenses:string[]=[],changes?:{base:string;stat:string;untracked:string[];patchFile:string},references?:string[]){
 const s=await store.load(),t=taskOf(s,id),context=await packet(store,id);
 const checks=await Promise.all(t.checks.map(async command=>{const receipt=t.receipts.find(r=>r.id===command.id);
  return {command,receipt,executed:!!receipt,passed:receipt?.code===0,current:receipt?.fingerprint===t.fingerprint,output:receipt?await receiptTail(store,receipt.artifact):undefined};}));
 return {intent:s.intent,constraints:s.constraints,goal:t.goal,criteria:t.criteria,outcomes:s.criteria,references:references??t.references??[],
  workspace:t.workspace,fingerprint:t.workspace?await fingerprint(t.workspace):undefined,lenses,
  obligations:reviewObligations(s,t),artifactDirectory:join(store.root,'artifacts'),
  checks,changes,
  decisions:s.decisions.filter(d=>d.purpose==='requirement'&&d.choice&&context.decisions.some(ref=>ref.id===d.id)).map(d=>({id:d.id,question:d.question,choice:d.choice,answer:d.criteria[d.choice!]})),
  dependencies:s.tasks.filter(d=>('dependencies' in context && context.dependencies.some(ref=>ref.id===d.id))).map(d=>({id:d.id,goal:d.goal,criteria:d.criteria,workspace:d.workspace,integrated:d.integrated})),
  inspection:{standards:'Read applicable repository AGENTS.md and existing conventions. Context files are not automatically injected.',
   scope:changes?`The task's changes against ${changes.base} are in changes.patchFile, with a file summary in changes.stat and new files in changes.untracked. Start from that diff. Read other files only to trace callers and consumers of what changed, or to check a criterion the diff alone cannot show.`:'No Git diff is available for this workspace. Trace changed behavior to its callers and consumers; locate trustworthy scope evidence or mark the relevant boundary unreviewed.',
   probes:'Read registered command receipts via artifactDirectory. You cannot execute tests yourself, but a registered check whose receipt carries exit code 0 at the task fingerprint below did execute and did pass: that receipt is executed evidence, so cite it as covered rather than marking the obligation unreviewed. A nonzero or fingerprint-mismatched receipt is not evidence. Reserve unreviewed for behaviour no receipt covers, and name the exact host probe you need.'}};
}
// Killing pi alone leaves a hung grandchild running, holding the pipe open, so
// the close event never arrives. Windows needs the whole tree taken down.
export function killTree(child:{pid?:number;kill:(signal?:NodeJS.Signals)=>boolean}){
 if(!child.pid||process.platform!=='win32'){child.kill('SIGKILL');return;}
 const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
 killer.on('error',()=>{child.kill('SIGKILL');});
}
export const reviewFormatAttempts=2;
export const blockingDefinition='A finding is blocking only when it is a regression of existing behaviour, a failed task criterion, a false statement in documentation this task changed, or vendor code or setup for a third-party service that this task added with no source in the workspace or the task\'s references, such as an embed or tag snippet, the argument order of a vendor call or the steps in a vendor console. A preference, style choice or optional improvement is never blocking.';
// Windows caps a whole command line near 32767 characters; leave room for the
// executable, the flags and the session paths that sit alongside the prompt.
export const promptLimit=24000;
// Flash models routinely wrap the report in prose or a fenced block. Take the
// outermost balanced object rather than requiring the whole reply to be JSON.
export function reviewReport(text:string){
 const body=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
 const balanced=(start:number)=>{
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<body.length;i++){
   const ch=body[i];
   if(escaped){escaped=false;continue;}
   if(ch==='\\'){escaped=true;continue;}
   if(ch==='"'){quoted=!quoted;continue;}
   if(quoted)continue;
   if(ch==='{')depth++;
   else if(ch==='}'&&--depth===0)return body.slice(start,i+1);
  }
  return undefined;
 };
 const candidates=[body];
 for(let at=body.indexOf('{'),tried=0;at>=0&&tried<20;at=body.indexOf('{',at+1),tried++){const slice=balanced(at);if(slice)candidates.push(slice);}
 const parsed=candidates.map(candidate=>{try{const value=JSON.parse(candidate);return value&&typeof value==='object'&&!Array.isArray(value)?value:undefined;}catch{return undefined;}}).filter(Boolean);
 const report=parsed.find(value=>Array.isArray(value.coverage))??parsed[0];
 invariant(report,'Reviewer did not return a JSON report object; re-request the exact output shape');
 return report;
}
export async function reviewer(store:Store,id:string,model:string|undefined,lenses:string[],routing?:RoutingRequest,references?:string[]){const original=taskOf(await store.load(),id);invariant(original.workspace,'Task workspace missing');const route=await selectModel(store,id,'reviewer',original.workspace,routing);if(route.action!=='launch')return route;invariant(!model||model===route.model,'Explicit reviewer disagrees with recorded route; omit model for automatic selection');model=route.model;const s=await store.load(),t=taskOf(s,id);invariant(t.status==='review'&&t.workspace,'Task not awaiting review');invariant(family(model)!==t.family,'Reviewer must use a different model family');const fp=await fingerprint(t.workspace);invariant(fp===route.scope.content,'Review content changed after routing; route again');
 const diff=await taskDiff(s.workspace,t.workspace);
 const changes=diff&&{base:diff.base,stat:diff.stat,untracked:diff.untracked,patchFile:await handoffFile(store,id,'review-diff.patch',diff.patch)};
 const clean=await reviewPacket(store,id,lenses,changes,references);
 const {reviewerMaxTurns}=await loadModelConfig();
 const prompt=`You are an independent read-only reviewer. You have at most ${reviewerMaxTurns} turns; a reply that arrives later is discarded, so spend them on the diff and the consumers it touches, not on rereading the repository. Inspect actual files and affected consumers. Report only supported reachable defects, not hypothetical requirements. Find every blocking defect you can in one pass; do not omit defects that share a root cause. Keep Spec and Standards coverage distinct. Do not invoke other skills. Return ONLY JSON with report (nonempty string explaining coverage), coverage (array), and findings (array). For EVERY supplied obligation return exactly one coverage entry {id,status,evidence}. Status is covered, finding, unreviewed, or not-applicable. Use covered when you inspected the obligation and found no defect — that is the normal result. Use finding ONLY when you are also filing that defect in the findings array; a finding status with an empty findings array is rejected. Use unreviewed only when you genuinely could not inspect it, naming the exact host probe you need. Evidence must name inspected files/consumers or executed receipt paths and observed results, or the exact missing host probe. This task's own criteria can never be not-applicable: they are what it was asked to deliver. A run outcome may be not-applicable only when no change in this workspace could affect it either way, and the evidence must name the task or component that owns it; otherwise explain this task's contribution or preservation. Other nonapplicability needs a concrete reason. A finding entry remains unresolved until a corrected review. Enumerate reachable failure/recovery exits, protocol boundaries, shared ownership and affected consumers before judging these obligations. Never invent execution evidence or treat no findings as complete coverage. Every finding must be located in a file inside this task's workspace and must describe a defect in the changes under review. The status of other tasks, provider or model availability, coordinator behaviour and run orchestration are outside your scope: never report them as findings, and never let them make an obligation a finding. Judging this task means judging what is in this workspace. Each finding requires id,lens,location,scenario,evidence,consequence,blocking (boolean). Trace every vendor snippet, vendor call and vendor console step the change adds to the file it was copied from, in the workspace or among the packet's references. ${blockingDefinition} Group multiple lenses describing the same root defect into one finding; keep each lens and its evidence in the report. An empty findings array is allowed only after inspection.\nThe task contract, its obligations, the registered checks and their receipts are in "${await handoffFile(store,id,'review-packet.md',`# Review packet for ${id}\n\n\`\`\`json\n${JSON.stringify(clean,null,1)}\n\`\`\``)}". Read that file in full before inspecting anything. It sits outside the workspace: read it, never edit it.`;
 const operation=await acquireActivity(store,id,'review',undefined,async current=>{invariant(fp===await fingerprint(t.workspace!),'Review workspace changed during routing');consumeRoute(current,route);});
 try{
 const sessionDir=join(store.root,'sessions',`${id}-review-${Date.now()}-${randomUUID().slice(0,8)}`);
 let correction:string|undefined,lastFormatError='',usage:CallUsage|undefined;
 for(let attempt=1;;attempt++){
  // One review is one speed sample: a correction continues the same session and adds to it.
  const out=await piRun({workspace:t.workspace,model,prompt:correction??prompt,continueSession:correction!==undefined,diagnosticRoot:store.root,speedDir:store.amalehDir,speedCarry:usage,deferSpeedOnSuccess:true,sessionDir,readOnly:true,maxTurns:reviewerMaxTurns,onSpawn:pid=>activitySpawned(store,id,operation,pid)});
  usage=out.usage;
  try{
   const report=reviewReport(out.text);
   await review(store,id,{model,findings:report.findings,coverage:report.coverage,report:report.report,fingerprint:fp});
   await recordCallSpeed(store.amalehDir,model,'reviewer',usage);
   return {findings:report.findings,artifact:await store.artifact(out)};
  }catch(error){
   const message=(error as Error).message;
   if(attempt>=reviewFormatAttempts||transientProvider(message)){
    await recordCallSpeed(store.amalehDir,model,'reviewer',usage,true);
    throw new Error(lastFormatError&&lastFormatError!==message?`Reviewer output stayed malformed across ${attempt} attempts: ${lastFormatError}, then ${message}`:message);
   }
   lastFormatError=message;
   await store.transaction(s=>event(s,'review-format-retry',{id,model,attempt,reason:message})).catch(()=>{});
   correction=`Your previous reply was rejected: ${message}\nYour inspection so far is in this session: answer from it rather than reading the workspace again. Return ONLY this JSON object, with no surrounding prose and no code fence. All three top-level keys are required, including a nonempty "report":\n{"report":"one paragraph naming the files you inspected and what you observed","coverage":[{"id":"<one entry per supplied obligation id>","status":"covered|finding|unreviewed|not-applicable","evidence":"what you inspected and saw"}],"findings":[]}\nEvery finding, if any, needs id, lens, location, scenario, evidence, consequence and blocking. If you cannot evidence a finding, omit it rather than sending it incomplete.`;
  }
 }
 }catch(e){if(transientProvider((e as Error).message))await store.transaction(s=>event(s,'provider-unavailable',{model,family:family(model!),taskId:id,purpose:'reviewer'})).catch(()=>{});throw e;}finally{await releaseActivity(store,id,operation);}}
