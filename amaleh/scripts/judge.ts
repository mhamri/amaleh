import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestJson, catalog, reviewReport, settledProviderFailure } from './adapters.ts';
import { loadModelConfig, configPath } from './config.ts';
import { family } from './family.ts';
import { hash } from './core.ts';
import { decodePng, describePalette, measuredPalette, meanDifference, type Pixels } from './png.ts';
import { visualDifference } from './design.ts';

export type VisualDifference={area:string;expected:string;actual:string;severity:'blocking'|'minor'};
export type VisualVerdict={verdict:'match'|'differs';model:string;summary:string;differences:VisualDifference[];meanDifference?:number};
type JudgeInput={reference:string;render:string;seed:string;authorFamily?:string;root?:string};

const judgeModelsTried=2;
const severities=new Set(['blocking','minor']);

export async function visualJudgeModels(seed:string,authorFamily:string|undefined,fetcher:typeof fetch=fetch){
 const {flash}=await loadModelConfig(),cards=new Map<string,{modalities?:string[]}>((await catalog(undefined,fetcher)).models.map((m:{id:string;modalities?:string[]})=>[m.id,m]));
 const eligible=flash.filter(id=>cards.get(id)?.modalities?.includes('image')&&family(id)!==authorFamily);
 if(!eligible.length)throw new Error(`No flash model in ${configPath()} accepts image input${authorFamily?` outside the worker's family ${authorFamily}`:''}; add one so the render can be judged`);
 const first=parseInt(hash(seed).slice(0,8),16)%eligible.length;
 return [...eligible.slice(first),...eligible.slice(0,first)].slice(0,judgeModelsTried);
}

const facts=(label:string,p:Pixels)=>`${label}: ${p.width}x${p.height} pixels; ${describePalette(measuredPalette(p))}`;
const instructions=(design:Pixels,built:Pixels,difference:number|undefined)=>`You compare two pictures of a user interface. Picture 1 is the approved design. Picture 2 is a screenshot of the built work. Decide whether the built work matches the design.
Facts measured from the pixels:
- ${facts('Design',design)}
- ${facts('Built work',built)}
${difference===undefined?'- The pictures differ in size, so no pixel difference was measured.':`- Mean channel difference: ${difference.toFixed(1)} of 255.`}
A difference is blocking when a person who compares the two pictures would say the build is not the design: ${visualDifference.blocking}.
A difference is minor when it is ${visualDifference.minor}.
Reply with only this JSON object and no other text:
{"summary":"one sentence","differences":[{"area":"where in the picture","expected":"what the design shows","actual":"what the build shows","severity":"blocking or minor"}]}
An empty differences array means the build matches the design.`;

const dataUrl=(bytes:Buffer)=>`data:image/png;base64,${bytes.toString('base64')}`;
function verdictOf(text:string,model:string,difference:number|undefined):VisualVerdict{
 const report=reviewReport(text) as {summary?:unknown;differences?:unknown};
 const differences=report.differences;
 if(!Array.isArray(differences)||!differences.every(d=>d&&typeof d==='object'&&severities.has((d as VisualDifference).severity)))throw new Error(`Visual judge ${model} replied without a valid differences array`);
 const listed=differences.map(d=>({area:String(d.area??''),expected:String(d.expected??''),actual:String(d.actual??''),severity:d.severity as VisualDifference['severity']}));
 return {verdict:listed.some(d=>d.severity==='blocking')?'differs':'match',model,summary:String(report.summary??''),differences:listed,...(difference===undefined?{}:{meanDifference:Math.round(difference*10)/10})};
}

export async function judgeRender(input:JudgeInput,fetcher:typeof fetch=fetch):Promise<VisualVerdict>{
 const [referenceBytes,renderBytes]=await Promise.all([readFile(input.reference),readFile(input.render)]);
 const design=decodePng(referenceBytes),built=decodePng(renderBytes);
 if(!design)throw new Error(`Design picture ${input.reference} is not a readable PNG`);
 if(!built)throw new Error(`Render ${input.render} is not a readable PNG`);
 const difference=meanDifference(design,built),prompt=instructions(design,built,difference);
 const failures:string[]=[];
 for(const model of await visualJudgeModels(input.seed,input.authorFamily,fetcher)){
  try{
   const value=await requestJson('https://openrouter.ai/api/v1/chat/completions',{model,temperature:0,messages:[{role:'user',content:[
    {type:'text',text:prompt},
    {type:'text',text:'Picture 1, the approved design:'},{type:'image_url',image_url:{url:dataUrl(referenceBytes)}},
    {type:'text',text:'Picture 2, the screenshot of the built work:'},{type:'image_url',image_url:{url:dataUrl(renderBytes)}}]}]},fetcher,input.root,{attempts:2,timeoutMs:120000});
   const content=value?.choices?.[0]?.message?.content;
   if(typeof content!=='string'||!content.trim())throw new Error(`Visual judge ${model} returned no text`);
   return verdictOf(content,typeof value.model==='string'?value.model:model,difference);
  }catch(error){
   const message=(error as Error).message;
   failures.push(`${model}: ${message}`);
   if(settledProviderFailure(message))break;
  }
 }
 throw new Error(`No visual judge answered: ${failures.join('; ')}`);
}

async function main(){
 const [reference,render,root,authorFamily,seed]=process.argv.slice(2);
 if(!reference||!render||!seed)throw new Error('Usage: bun judge.ts <design.png> <render.png> <run-root|-> <author-family|-> <seed>');
 const verdict=await judgeRender({reference,render,seed,root:root&&root!=='-'?root:undefined,authorFamily:authorFamily&&authorFamily!=='-'?authorFamily:undefined});
 console.log(JSON.stringify(verdict));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=2;});
