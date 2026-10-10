import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng } from './png.ts';

const screenshotTimeoutMs=60000;
const pollMs=200;
const defaultSize={width:1280,height:800};
const browserCandidates=()=>process.platform==='win32'
 ?['ProgramFiles(x86)','ProgramFiles','LOCALAPPDATA'].flatMap(root=>process.env[root]?[join(process.env[root]!,'Microsoft','Edge','Application','msedge.exe'),join(process.env[root]!,'Google','Chrome','Application','chrome.exe')]:[])
 :process.platform==='darwin'
 ?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium']
 :(process.env.PATH??'').split(delimiter).filter(Boolean).flatMap(dir=>['google-chrome','google-chrome-stable','chromium','chromium-browser','microsoft-edge'].map(name=>join(dir,name)));

export async function findBrowser(){
 if(process.env.AMALEH_BROWSER)return process.env.AMALEH_BROWSER;
 for(const candidate of browserCandidates()){try{await access(candidate);return candidate;}catch{}}
 throw new Error('No Chromium-based browser (Edge, Chrome or Chromium) was found; set AMALEH_BROWSER to its executable');
}
async function pageUrl(page:string){
 if(/^[a-z][a-z0-9+.-]*:\/\//i.test(page))return page;
 const path=resolve(page);
 try{await access(path);}catch{throw new Error(`Page ${path} does not exist`);}
 return pathToFileURL(path).href;
}
function runBrowser(browser:string,args:string[]){
 return new Promise<{code:number;stderr:string}>((done,fail)=>{
  const child=spawn(browser,args,{stdio:['ignore','ignore','pipe'],windowsHide:true});
  let stderr='';child.stderr.on('data',d=>stderr+=d);
  const timer=setTimeout(()=>child.kill(),screenshotTimeoutMs);
  child.on('error',error=>{clearTimeout(timer);fail(error);});
  child.on('close',code=>{clearTimeout(timer);done({code:code??1,stderr});});
 });
}
async function completePicture(path:string,deadline:number){
 for(;;){
  const picture=decodePng(await readFile(path).catch(()=>Buffer.alloc(0)));
  if(picture||Date.now()>=deadline)return picture;
  await new Promise(r=>setTimeout(r,pollMs));
 }
}
export async function screenshot(input:{page:string;out:string;width:number;height:number;settleMs?:number}){
 const [browser,url]=await Promise.all([findBrowser(),pageUrl(input.page)]),profile=await mkdtemp(join(tmpdir(),'amaleh-screenshot-')),deadline=Date.now()+screenshotTimeoutMs;
 try{
  await rm(input.out,{force:true});
  const {code,stderr}=await runBrowser(browser,['--headless=new','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${input.width},${input.height}`,`--virtual-time-budget=${input.settleMs??3000}`,`--screenshot=${input.out}`,url]);
  const picture=await completePicture(input.out,deadline);
  if(!picture)throw new Error(`${browser} wrote no complete PNG to ${input.out} within ${screenshotTimeoutMs/1000} seconds (exit ${code})${stderr.trim()?`: ${stderr.trim().slice(-800)}`:''}`);
  return {width:picture.width,height:picture.height};
 }finally{await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:pollMs}).catch(()=>{});}
}

const pixels=(value:string|undefined,name:string)=>{if(value===undefined)return undefined;const n=Number(value);if(!Number.isInteger(n)||n<1||n>8000)throw new Error(`${name} must be a whole number of pixels from 1 to 8000, not ${value}`);return n;};
export function screenshotOptions(argv:string[],env:NodeJS.ProcessEnv=process.env){
 const flags=new Map<string,string>(),pages:string[]=[];
 for(let i=0;i<argv.length;i++){const arg=argv[i];if(['--out','--width','--height'].includes(arg)){if(argv[i+1]===undefined)throw new Error(`${arg} needs a value`);flags.set(arg,argv[++i]);}else pages.push(arg);}
 if(pages.length!==1)throw new Error('Usage: screenshot.ts <page file or URL> [--out <png>] [--width <px>] [--height <px>]. Inside a render check the output path and size come from AMALEH_RENDER, AMALEH_RENDER_WIDTH and AMALEH_RENDER_HEIGHT');
 const out=flags.get('--out')??env.AMALEH_RENDER;
 if(!out)throw new Error('No output path: pass --out, or run inside a render check, which sets AMALEH_RENDER');
 return {page:pages[0],out:resolve(out),width:pixels(flags.get('--width'),'--width')??pixels(env.AMALEH_RENDER_WIDTH,'AMALEH_RENDER_WIDTH')??defaultSize.width,height:pixels(flags.get('--height'),'--height')??pixels(env.AMALEH_RENDER_HEIGHT,'AMALEH_RENDER_HEIGHT')??defaultSize.height};
}

async function main(){
 const options=screenshotOptions(process.argv.slice(2));
 const size=await screenshot(options);
 console.log(`Wrote ${options.out} (${size.width}x${size.height} pixels) from ${options.page}`);
 if(size.width!==options.width||size.height!==options.height)console.error(`The screenshot is ${size.width}x${size.height} pixels, not the requested ${options.width}x${options.height}`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
