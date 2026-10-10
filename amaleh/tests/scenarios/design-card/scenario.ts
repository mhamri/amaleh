import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario, ScorecardRow } from '../bench.ts';
import { screenshot } from '../../../scripts/screenshot.ts';
import { decodePng, hexDistance, measuredPalette, meanDifference } from '../../../scripts/png.ts';
import { describeMeasuredElements, everyElementHolds, measuredElements } from '../../../scripts/design.ts';

const screenshotScript=fileURLToPath(new URL('../../../scripts/screenshot.ts',import.meta.url));
const pictureAt=(root:string)=>join(root,'design','card.png');
const expectedText=['Monthly revenue','$48,250','+12.4%','Jan','Feb','Mar','Apr','May','Jun'];
const keyColorShare=0.02;
const colorTolerance=40;
const layoutTolerance=15;

const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
const visibleText=(html:string)=>html
 .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi,' ')
 .replace(/<[^>]*>/g,' ')
 .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(parseInt(code,16)))
 .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
 .replace(/&([a-z]+);/gi,(whole,name)=>entities[name.toLowerCase()]??whole)
 .replace(/\s+/g,' ');

async function judgedPage(root:string,page:string):Promise<ScorecardRow[]>{
 const text=visibleText(await readFile(page,'utf8')),missing=expectedText.filter(t=>!text.includes(t));
 const design=decodePng(await readFile(pictureAt(root)))!,out=join(root,'verdict-render.png');
 await screenshot({page,out,width:design.width,height:design.height});
 const built=decodePng(await readFile(out))!;
 const keyColors=measuredPalette(design).main.filter(s=>s.share>=keyColorShare),palette=measuredPalette(built),builtColors=[...palette.main,...palette.accents];
 const absent=keyColors.filter(k=>!builtColors.some(b=>hexDistance(b.hex,k.hex)<=colorTolerance));
 const difference=meanDifference(design,built),measured=measuredElements(design,built);
 return [
  {name:'text of the design',value:missing.length?`missing: ${missing.join(', ')}`:'all present',pass:!missing.length},
  {name:'key colors of the design',value:absent.length?`missing: ${absent.map(a=>a.hex).join(', ')}`:`all present: ${keyColors.map(k=>k.hex).join(', ')}`,pass:!absent.length},
  {name:'layout against the design',value:difference===undefined?`the render is ${built.width}x${built.height} pixels`:`mean difference ${difference.toFixed(1)} of 255, at most ${layoutTolerance} allowed; render ${out}`,pass:difference!==undefined&&difference<=layoutTolerance},
  {name:'measured elements against the design',value:!measured?`the render is ${built.width}x${built.height} pixels`:`${describeMeasuredElements(measured)}${measured.differences.map(d=>`; ${d.area}: ${d.actual}`).join('')}`,pass:!!measured&&everyElementHolds(measured)}];
}

const scenario:Scenario={
 intent:'Prove that a cheap worker builds a screen from a design picture: one small statistics card, given only as a PNG',
 criteria:['card.html shows the card in the design picture, with the same layout, text, numbers, colors and proportions'],
 constraints:['Create only card.html','Use only HTML and CSS in that one file, with no scripts and no network resources'],
 fixtures:{'design/card.png':{copy:'card.png'}},
 tasks:root=>[{id:'card',title:'Revenue card',phase:'design',deps:[],resources:['card.html'],kind:'code',
  goal:'Build card.html, one self-contained page that shows the statistics card in the design picture. Use only HTML and CSS in that file, with no scripts and no network resources.',
  criteria:['card.html shows the card in the design picture, with the same layout, text, numbers, colors and proportions','Only card.html is created or changed'],
  images:[pictureAt(root)],
  checks:[{id:'render',command:process.execPath,args:[screenshotScript,'card.html'],role:'probe',render:pictureAt(root)}]}],
 verdict:async({root,spaces})=>{
  const page=join(spaces.card,'card.html');
  try{return await judgedPage(root,page);}
  catch(error){return [{name:'card.html judged against the design',value:(error as Error).message,pass:false}];}
 },
};
export default scenario;
