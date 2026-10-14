import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const stdoutFile='stdout.jsonl';
export const launchLog='argv.jsonl';
export const launchCount='launches.txt';
export const jsonl=(items:unknown[])=>items.map(item=>JSON.stringify(item)).join('\n');
export const launchOutputs=(first:unknown[],later:unknown[])=>({'first.jsonl':jsonl(first),'later.jsonl':jsonl(later)});

export const definesSibling='const sibling=(name)=>new URL(name,import.meta.url);\n';
export const readStdout=`import {readFileSync} from 'node:fs';\n${definesSibling}const stdout=readFileSync(sibling('${stdoutFile}'),'utf8');\n`;
export const printsStdout=`${readStdout}process.stdout.write(stdout);\n`;
export const printsStdoutAndStaysAlive=`${printsStdout}setInterval(()=>{},1000);\n`;
export const recordsLaunch=`import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';\n${definesSibling}appendFileSync(sibling('${launchLog}'),JSON.stringify(process.argv.slice(2))+'\\n');\nlet launch=0;try{launch=Number(readFileSync(sibling('${launchCount}'),'utf8'));}catch{}\nwriteFileSync(sibling('${launchCount}'),String(launch+1));\n`;
export const readsLaunchOutput=`${recordsLaunch}const stdout=readFileSync(sibling(launch===0?'first.jsonl':'later.jsonl'),'utf8');\n`;
export const printsLaunchOutput=`${readsLaunchOutput}process.stdout.write(stdout);\n`;

export async function writeFakeProgram(dir:string,name:string,source:string,files:Record<string,string>={}){
 const entry=join(dir,name);
 await writeFile(entry,source);
 for(const [file,text] of Object.entries(files))await writeFile(join(dir,file),text);
 return entry;
}
export const writeFakePi=(dir:string,source:string,files:Record<string,string>={})=>writeFakeProgram(dir,'fake-pi.ts',source,files);
