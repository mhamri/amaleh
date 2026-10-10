import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import type { DesignImage } from './core.ts';
import { decodePng, describePalette, hexDistance, measuredPalette, pairedShapes, pictureShapes, pngSize, type Box, type Pixels, type Region } from './png.ts';

const pictureLimit=10*1024*1024;
const briefElementsAtMost=24;

export type VisualDifference={area:string;expected:string;actual:string;severity:'blocking'|'minor'};
export type MeasuredElements={solids:number;solidsCompared:number;texts:number;textsCompared:number;differences:VisualDifference[]};

export const visualTolerance={sizeShare:.1,sizePixels:3,edgeShare:.02,edgePixels:4,textColor:40};
const percent=(share:number)=>`${Math.round(share*100)}%`;
export const visualDifference={
 blocking:`a missing or extra element; a different layout or order; a different chart type, or a chart that lacks its data; different text or numbers; a clearly different color on a surface, an accent, a chart series or text; an element or text line whose width or height differs from the design by more than ${percent(visualTolerance.sizeShare)} and more than ${visualTolerance.sizePixels} pixels; an element or text line edge that is more than ${percent(visualTolerance.edgeShare)} of the picture's width or height, and more than ${visualTolerance.edgePixels} pixels, away from its place in the design; a text line whose ink color is more than ${visualTolerance.textColor} away from the design's ink color, as a distance between RGB values; overlapping or clipped content`,
 minor:'only font rendering or font substitution, anti-aliasing, a slightly different shade, or a size, place or ink color difference inside those limits',
};

const boxText=(b:Box)=>`${b.width}x${b.height} pixels at x ${b.x}, y ${b.y}`;
function outsideLimits(design:Box,built:Box,picture:{width:number;height:number}){
 const {sizeShare,sizePixels,edgeShare,edgePixels}=visualTolerance,found:string[]=[];
 for(const [name,want,got] of [['width',design.width,built.width],['height',design.height,built.height]] as const){
  const change=Math.abs(got-want);
  if(change>want*sizeShare&&change>sizePixels)found.push(`${name} ${percent(change/want)} ${got<want?'smaller':'larger'} (${change} pixels)`);
 }
 for(const [name,want,got,span,less,more] of [
  ['left edge',design.x,built.x,picture.width,'to the left','to the right'],
  ['right edge',design.x+design.width,built.x+built.width,picture.width,'to the left','to the right'],
  ['top edge',design.y,built.y,picture.height,'higher','lower'],
  ['bottom edge',design.y+design.height,built.y+built.height,picture.height,'higher','lower']] as const){
  const shift=Math.abs(got-want);
  if(shift>span*edgeShare&&shift>edgePixels)found.push(`${name} ${shift} pixels ${got<want?less:more}`);
 }
 return found;
}

const inkOutsideLimit=(design:Region,built:Region)=>hexDistance(design.hex,built.hex)>visualTolerance.textColor?[`ink color ${built.hex} instead of ${design.hex}`]:[];
const blockingDifference=(area:string,design:Region,built:Region,outside:string[]):VisualDifference[]=>outside.length?[{area,expected:boxText(design),actual:`${boxText(built)}: ${outside.join(', ')}`,severity:'blocking'}]:[];
const byPlace=([a]:[Region,Region],[b]:[Region,Region])=>a.y-b.y||a.x-b.x;

export function measuredElements(design:Pixels,built:Pixels):MeasuredElements|undefined{
 if(design.width!==built.width||design.height!==built.height)return undefined;
 const {solids,texts}=pairedShapes(design,built);
 const differences=[
  ...solids.flatMap(g=>g.pairs).sort(byPlace).flatMap(([ours,theirs])=>blockingDifference(`the ${ours.hex} element at x ${ours.x}, y ${ours.y} of the design`,ours,theirs,outsideLimits(ours,theirs,design))),
  ...[...texts.pairs].sort(byPlace).flatMap(([ours,theirs])=>blockingDifference(`the ${ours.hex} text line at x ${ours.x}, y ${ours.y} of the design`,ours,theirs,[...outsideLimits(ours,theirs,design),...inkOutsideLimit(ours,theirs)])),
 ];
 return {solids:solids.reduce((n,g)=>n+g.design.length,0),solidsCompared:solids.reduce((n,g)=>n+g.pairs.length,0),texts:texts.design.length,textsCompared:texts.pairs.length,differences};
}
export const everyElementHolds=(measured:MeasuredElements)=>measured.solids+measured.texts>0&&measured.solidsCompared===measured.solids&&measured.textsCompared===measured.texts&&!measured.differences.length;
const was=(count:number)=>count===1?'was':'were';
export const describeMeasuredElements=(m:MeasuredElements)=>`${m.solidsCompared} of the design's ${m.solids} solid elements ${was(m.solidsCompared)} found in the build with the same count per color, ${m.textsCompared} of its ${m.texts} text lines ${was(m.textsCompared)} found near their place, and ${m.differences.length} of the found ones ${m.differences.length===1?'is':'are'} outside the size, place and ink color limits`;

const listOf=(regions:Region[])=>[...regions].sort((a,b)=>b.area-a.area).slice(0,briefElementsAtMost).sort((a,b)=>a.y-b.y||a.x-b.x).map(r=>`${r.hex} ${r.width}x${r.height} at x ${r.x}, y ${r.y}`).join('; ');

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
 return {width:size?.width,height:size?.height,palette:pixels?measuredPalette(pixels):undefined,...(pixels?pictureShapes(pixels):{solids:[],texts:[]})};
}

export async function designBriefSection(images:DesignImage[],renderChecks:{id:string;render:string}[]){
 if(!images.length)return '';
 const described=await Promise.all(images.map(async image=>{
  const facts=await pictureFacts(image.path),checks=renderChecks.filter(c=>c.render===image.source).map(c=>c.id);
  return {measured:facts.solids.length+facts.texts.length>0,line:`- ${image.source} (file: ${image.path}): ${facts.width}x${facts.height} pixels; ${facts.palette?describePalette(facts.palette):'colors not measured'}${checks.length?`. Visual check${checks.length>1?'s':''} ${checks.join(', ')} compare${checks.length>1?'':'s'} your work with it`:''}${facts.solids.length?`\n  - Solid elements measured in it, as color, width x height in pixels, and top-left corner: ${listOf(facts.solids)}`:''}${facts.texts.length?`\n  - Text lines measured in it, as ink color, width x height in pixels, and top-left corner: ${listOf(facts.texts)}`:''}`};
 }));
 const lines=described.map(d=>d.line);
 return `## Design pictures
This task builds what the approved pictures below show. Each picture is attached to your prompt, and its file is listed. Look at every picture before you write code.
${lines.join('\n')}
- Match each picture's layout, content, colors and proportions.
- The colors listed above are measured from the picture's own pixels, so they are the design's colors. Put them into the project's theme or token files as the theme values, then use them through those values. Where the project's existing theme disagrees with a picture, the picture is correct.
- Use the chart and UI packages the project already depends on before you draw anything by hand.
- A visual check runs your render command, which writes a PNG screenshot to the path in the AMALEH_RENDER environment variable, and a separate model compares that screenshot with the picture. AMALEH_RENDER_WIDTH and AMALEH_RENDER_HEIGHT hold the picture's size in pixels. Never copy or re-encode a design picture as the screenshot, and never show a design picture inside the built work: build the screen itself.
${described.some(d=>d.measured)?'- A solid element is an area of one color, such as a card, a bar or a badge. A text line is one row of letters or small marks. Its height comes from the font size, and its ink color is the color of the letters, measured from their pixels farthest from the background. A text line box covers only the pixels of the letters, not the CSS line box, so it is shorter than the line height and starts lower than the line box. Build each element and each text line at the size, place and color listed, in picture pixels. The visual check measures the same things in your screenshot.\n':''}- The visual check fails only on a blocking difference: ${visualDifference.blocking}. A minor difference never fails it: ${visualDifference.minor}. When no blocking difference is left, the work is done: do not move elements pixel by pixel to copy the picture exactly.`;
}

export const renderEnvironment=(path:string,width?:number,height?:number):Record<string,string>=>({AMALEH_RENDER:path,...(width&&height?{AMALEH_RENDER_WIDTH:String(width),AMALEH_RENDER_HEIGHT:String(height)}:{})});
