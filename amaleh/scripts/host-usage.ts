import {readdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';

// See references/runtime.md#main-model-usage
export type HostUsage={available:true;source:string;turns:number;toolCalls:number;inputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;outputTokens:number}|{available:false;reason:string};
export const claudeTranscriptDir=(workspace:string)=>process.env.AMALEH_HOST_TRANSCRIPTS??join(process.env.CLAUDE_CONFIG_DIR??join(homedir(),'.claude'),'projects',workspace.replace(/[^a-zA-Z0-9]/g,'-'));
async function transcripts(dir:string,since:number):Promise<string[]>{
 const found:string[]=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())found.push(...await transcripts(path,since));
  else if(entry.name.endsWith('.jsonl')&&(await stat(path)).mtimeMs>=since)found.push(path);
 }
 return found;
}
const count=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:0;};
export async function hostUsage(host:{kind:string},workspace:string,from:number,to:number):Promise<HostUsage>{
 if(host.kind!=='claude')return {available:false,reason:`No transcript reader exists for host kind ${host.kind}, so the main model's token use in this run is not measured`};
 const source=claudeTranscriptDir(workspace);
 let files:string[];
 try{files=await transcripts(source,from);}catch(error){return {available:false,reason:`Claude Code transcripts were not readable at ${source}: ${(error as Error).message}`};}
 const turns=new Map<string,{usage:Record<string,unknown>;toolCalls:number}>();
 for(const file of files)for(const line of (await readFile(file,'utf8')).split('\n')){
  if(!line)continue;
  let row:{type?:string;timestamp?:string;message?:{id?:string;usage?:Record<string,unknown>;content?:{type?:string}[]}};
  try{row=JSON.parse(line);}catch{continue;}
  const at=Date.parse(row.timestamp??'');
  if(row.type!=='assistant'||!row.message?.id||!row.message.usage||!(at>=from&&at<=to))continue;
  turns.set(row.message.id,{usage:row.message.usage,toolCalls:(turns.get(row.message.id)?.toolCalls??0)+(Array.isArray(row.message.content)?row.message.content.filter(block=>block?.type==='tool_use').length:0)});
 }
 const total=(field:string)=>[...turns.values()].reduce((sum,turn)=>sum+count(turn.usage[field]),0);
 return {available:true,source,turns:turns.size,toolCalls:[...turns.values()].reduce((sum,turn)=>sum+turn.toolCalls,0),inputTokens:total('input_tokens'),cacheReadTokens:total('cache_read_input_tokens'),cacheWriteTokens:total('cache_creation_input_tokens'),outputTokens:total('output_tokens')};
}
