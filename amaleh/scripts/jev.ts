// Worker-side Jev helper: a routed worker consults Jev mid-task for uncertain
// semantic choices, without spending coordinator turns. The coordinator never
// sees these calls; they are recorded as worker-jev events for health auditing.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, event, jevTaskContext } from './core.ts';
import { jevModel } from './config.ts';
import { requestJson, choiceAnswer } from './adapters.ts';

type JevAnswer = { choice?:string; confidence?:number; source:string; reason?:string };

export async function jevAsk(store:Store,input:{taskId?:string;question:string;options:string[]|Record<string,string>;state?:unknown},fetcher?:typeof fetch):Promise<JevAnswer>{
 const criteria=Array.isArray(input.options)?Object.fromEntries(input.options.map(o=>[o,o])):input.options;
 if(!input.question||Object.keys(criteria).length<2)throw new Error('Jev ask needs a question and at least two options');
 let s:Awaited<ReturnType<Store['load']>>;
 try{s=await store.load();}catch(e){throw new Error(`No Amaleh run at ${store.root}: pass the run's workspace, not the task workspace. ${(e as Error).message}`);}
 const task=input.taskId?s.tasks.find(t=>t.id===input.taskId):undefined;
 const state={...(task?jevTaskContext(s,task):{}),...(input.state===undefined?{}:{workerState:input.state})};
 const raw=await requestJson('https://openrouter.ai/api/alpha/decisions',{model:await jevModel(),state,questions:{selection:{type:'choice',instructions:input.question,criteria}}},fetcher,store.root);
 let answer:JevAnswer;try{answer=choiceAnswer(raw,criteria);}catch(e){answer={source:'invalid-jev-response',reason:(e as Error).message};}
 await store.transaction(s=>event(s,'worker-jev',{taskId:input.taskId,question:input.question,...answer})).catch(()=>{});
 return answer;
}

async function main(){
 const [workspace,runId,taskId,question,options,state]=process.argv.slice(2);
 if(!workspace||!runId||!question||!options)throw new Error('Usage: bun jev.ts <workspace> <run-id> <task-id|-> "<question>" "<optionA>|<optionB>|..." [state]');
 const answer=await jevAsk(new Store(workspace,runId),{taskId:taskId&&taskId!=='-'?taskId:undefined,question,options:options.split('|').map(o=>o.trim()).filter(Boolean),state});
 console.log(JSON.stringify(answer.choice?answer:{...answer,guidance:'Jev is not confident; choose the safest option, record why in your result, and continue.'},null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
