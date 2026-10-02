import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invariant } from './core.ts';

export type ModelConfig = { flash:string[]; deep:string[]; jev:string; providerCooldownMs:number; providerFailovers:number; launchAttempts:number; idleTimeoutMs:number; workerTimeoutMs:number; reviewerTimeoutMs:number; slowModelWindowMs:number; reviewerMaxTurns:number; lightReviewLines:number };

export const configPath=()=>resolve(process.env.AMALEH_MODELS??join(dirname(fileURLToPath(import.meta.url)),'..','models.json'));
export const isAlias=(model:string)=>/^~|[/:_-]latest(?:$|[/:_-])/i.test(model);

function modelList(value:unknown,field:string,path:string){
 invariant(Array.isArray(value)&&value.length>0&&value.every(v=>typeof v==='string'&&v.trim()),`${field} in ${path} must be a non-empty array of exact OpenRouter model ids`);
 const list=value as string[],repeated=[...new Set(list.filter((id,i)=>list.indexOf(id)!==i))];
 invariant(!repeated.length,`${field} in ${path} repeats ${repeated.join(', ')}; list each model once`);
 return list;
}
function whole(value:unknown,field:string,path:string,min:number,max:number){
 invariant(Number.isInteger(value)&&(value as number)>=min&&(value as number)<=max,`${field} in ${path} must be a whole number between ${min} and ${max}`);
 return value as number;
}
function optionalWhole(value:unknown,field:string,path:string,min:number,max:number,fallback:number){
 return value===undefined?fallback:whole(value,field,path,min,max);
}

export async function loadModelConfig(path=configPath()):Promise<ModelConfig>{
 let text:string;
 try{text=await readFile(path,'utf8');}catch(e){throw new Error(`Model configuration unreadable at ${path}: ${(e as Error).message}`);}
 let parsed:Record<string,unknown>;
 try{parsed=JSON.parse(text);}catch(e){throw new Error(`Model configuration at ${path} is not valid JSON: ${(e as Error).message}`);}
 invariant(typeof parsed.jev==='string'&&parsed.jev.trim(),`jev in ${path} must be an exact OpenRouter model id`);
 return {flash:modelList(parsed.flash,'flash',path),deep:modelList(parsed.deep,'deep',path),jev:parsed.jev as string,
  providerCooldownMs:whole(parsed.providerCooldownMs,'providerCooldownMs',path,0,3600000),
  providerFailovers:whole(parsed.providerFailovers,'providerFailovers',path,1,10),
  launchAttempts:whole(parsed.launchAttempts,'launchAttempts',path,1,5),
  idleTimeoutMs:whole(parsed.idleTimeoutMs,'idleTimeoutMs',path,0,7200000),
  workerTimeoutMs:optionalWhole(parsed.workerTimeoutMs,'workerTimeoutMs',path,0,86400000,2700000),
  reviewerTimeoutMs:optionalWhole(parsed.reviewerTimeoutMs,'reviewerTimeoutMs',path,0,86400000,2400000),
  slowModelWindowMs:whole(parsed.slowModelWindowMs,'slowModelWindowMs',path,0,2592000000),
  reviewerMaxTurns:whole(parsed.reviewerMaxTurns,'reviewerMaxTurns',path,5,500),
  lightReviewLines:optionalWhole(parsed.lightReviewLines,'lightReviewLines',path,0,100000,200)};
}

export async function jevModel(){return process.env.AMALEH_JEV_MODEL??(await loadModelConfig()).jev;}
