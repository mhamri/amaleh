import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { DesignImage } from './core.ts';
import { decodePng, describePalette, measuredPalette, pngSize } from './png.ts';

const pictureLimit=10*1024*1024;

export const visualDifference={
 blocking:'a missing, extra or moved element; a different layout or order; a different chart type, or a chart that lacks its data; different text or numbers; a clearly different color on a surface, an accent, a chart series or text; clearly different proportions or sizes; overlapping or clipped content',
 minor:'only font rendering or font substitution, anti-aliasing, a shift of a few pixels, a slightly different shade, or small spacing changes',
};

export function validDesignSources(taskId:string,images:unknown){
 if(images===undefined)return;
 if(!Array.isArray(images)||!images.every(i=>typeof i==='string'&&!!i.trim()))throw new Error(`Task ${taskId} images must be an array of picture paths`);
 const repeated=images.filter((i,at)=>images.indexOf(i)!==at);
 if(repeated.length)throw new Error(`Task ${taskId} lists design picture ${repeated[0]} more than once`);
 const other=images.find(i=>extname(i).toLowerCase()!=='.png');
 if(other)throw new Error(`Design picture ${other} of task ${taskId} is not a PNG file. Amaleh measures colors from PNG pixels only; export the picture as PNG`);
}

export async function storeDesignImages(runRoot:string,workspace:string,sources:string[]):Promise<DesignImage[]>{
 const folder=join(runRoot,'images');await mkdir(folder,{recursive:true});
 return Promise.all(sources.map(async source=>{
  const full=resolve(workspace,source);
  let bytes:Buffer;
  try{bytes=await readFile(full);}catch(error){throw new Error(`Design picture ${source} is not readable at ${full}: ${(error as Error).message}`);}
  if(bytes.length>pictureLimit)throw new Error(`Design picture ${source} is ${bytes.length} bytes; the limit is ${pictureLimit}. Export it smaller`);
  if(!decodePng(bytes))throw new Error(`Design picture ${source} at ${full} is not a readable PNG file`);
  const path=join(folder,`${createHash('sha256').update(bytes).digest('hex')}.png`);
  await writeFile(path,bytes,{flag:'wx'}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
  return {source,path};
 }));
}

export async function pictureFacts(path:string){
 const bytes=await readFile(path),pixels=decodePng(bytes),size=pngSize(bytes);
 return {width:size?.width,height:size?.height,palette:pixels?measuredPalette(pixels):undefined};
}

export async function designBriefSection(images:DesignImage[],renderChecks:{id:string;render:string}[]){
 if(!images.length)return '';
 const lines=await Promise.all(images.map(async image=>{
  const facts=await pictureFacts(image.path),checks=renderChecks.filter(c=>c.render===image.source).map(c=>c.id);
  return `- ${image.source} (file: ${image.path}): ${facts.width}x${facts.height} pixels; ${facts.palette?describePalette(facts.palette):'colors not measured'}${checks.length?`. Visual check${checks.length>1?'s':''} ${checks.join(', ')} compare${checks.length>1?'':'s'} your work with it`:''}`;
 }));
 return `## Design pictures
This task builds what the approved pictures below show. Each picture is attached to your prompt, and its file is listed. Look at every picture before you write code.
${lines.join('\n')}
- Match each picture's layout, content, colors and proportions.
- The colors listed above are measured from the picture's own pixels, so they are the design's colors. Put them into the project's theme or token files as the theme values, then use them through those values. Where the project's existing theme disagrees with a picture, the picture is correct.
- Use the chart and UI packages the project already depends on before you draw anything by hand.
- A visual check runs your render command, which writes a PNG screenshot to the path in the AMALEH_RENDER environment variable, and a separate model compares that screenshot with the picture. AMALEH_RENDER_WIDTH and AMALEH_RENDER_HEIGHT hold the picture's size in pixels. Never copy or re-encode a design picture as the screenshot, and never show a design picture inside the built work: build the screen itself.
- The visual check fails only on a blocking difference: ${visualDifference.blocking}. A minor difference never fails it: ${visualDifference.minor}. When no blocking difference is left, the work is done: do not move elements pixel by pixel to copy the picture exactly.`;
}

export const renderEnvironment=(path:string,width?:number,height?:number):Record<string,string>=>({AMALEH_RENDER:path,...(width&&height?{AMALEH_RENDER_WIDTH:String(width),AMALEH_RENDER_HEIGHT:String(height)}:{})});
