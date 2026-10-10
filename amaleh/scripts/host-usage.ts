import {createReadStream} from 'node:fs';
import {readdir,readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';

// See references/runtime.md#main-model-usage
export type HostUsage={available:true;source:string;turns:number;toolCalls:number;inputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;outputTokens:number}|{available:false;reason:string};
export const claudeTranscriptDir=(workspace:string)=>process.env.AMALEH_HOST_TRANSCRIPTS??join(process.env.CLAUDE_CONFIG_DIR??join(homedir(),'.claude'),'projects',workspace.replace(/[^a-zA-Z0-9]/g,'-'));
async function transcripts(dir:string,since:number,recurse=true):Promise<string[]>{
 const found:string[]=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory()){if(recurse)found.push(...await transcripts(path,since));}
  else if(entry.name.endsWith('.jsonl')&&(await stat(path)).mtimeMs>=since)found.push(path);
 }
 return found;
}
const count=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:0;};
const normalizedFolder=(path:string)=>{const folder=resolve(path).replace(/\\/g,'/').replace(/\/+$/,'');return process.platform==='win32'?folder.toLowerCase():folder;};
const sameOrNested=(a:string,b:string)=>{const x=normalizedFolder(a),y=normalizedFolder(b);return x===y||x.startsWith(`${y}/`)||y.startsWith(`${x}/`);};
const parse=(line:string)=>{try{return JSON.parse(line);}catch{return undefined;}};
const codexToolCalls=new Set(['function_call','custom_tool_call','local_shell_call']);
// Codex leaves a transcript's modified time at the session start, so it cannot rule a file out.
const everyModifiedTime=0;
async function codexUsage(workspace:string,from:number,to:number):Promise<HostUsage>{
 const source=process.env.CODEX_HOME??join(homedir(),'.codex');
 const files:string[]=[];
 let found=false;
 for(const [folder,recurse] of [[join(source,'sessions'),true],[join(source,'archived_sessions'),false]] as const){
  try{files.push(...await transcripts(folder,everyModifiedTime,recurse));found=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return {available:false,reason:`Codex transcripts were not readable at ${folder}: ${(error as Error).message}`};}
 }
 if(!found)return {available:false,reason:`No Codex session folders exist under ${source}`};
 const totals={turns:0,toolCalls:0,inputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:0};
 for(const file of files){
  const stream=createReadStream(file,{encoding:'utf8'}),lines=createInterface({input:stream,crlfDelay:Infinity});
  let meta:any,previousTotal:number|undefined;
  try{for await(const line of lines){
   if(meta===undefined){
    meta=parse(line)??null;
    if(meta?.type!=='session_meta'||typeof meta.payload?.cwd!=='string'||!sameOrNested(workspace,meta.payload.cwd)||Date.parse(meta.timestamp??'')>to)break;
    continue;
   }
   if(!line)continue;
   const row=parse(line);
   const at=Date.parse(row?.timestamp??'');
   if(!(at>=from&&at<=to))continue;
   if(row.type==='response_item'&&codexToolCalls.has(row.payload?.type))totals.toolCalls++;
   if(row.type!=='event_msg'||row.payload?.type!=='token_count'||!row.payload.info)continue;
   const cumulative=count(row.payload.info.total_token_usage?.total_tokens);
   if(cumulative===previousTotal)continue;
   previousTotal=cumulative;
   const last=row.payload.info.last_token_usage??{};
   totals.turns++;
   totals.inputTokens+=Math.max(0,count(last.input_tokens)-count(last.cached_input_tokens));
   totals.cacheReadTokens+=count(last.cached_input_tokens);
   totals.cacheWriteTokens+=count(last.cache_write_input_tokens);
   totals.outputTokens+=count(last.output_tokens);
  }}catch{}finally{lines.close();stream.destroy();}
 }
 return {available:true,source,...totals};
}
export async function hostUsage(host:{kind:string},workspace:string,from:number,to:number):Promise<HostUsage>{
 if(host.kind==='codex')return codexUsage(workspace,from,to);
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
