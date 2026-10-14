import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const stdoutFile='stdout.jsonl';
export const jsonl=(items:unknown[])=>items.map(item=>JSON.stringify(item)).join('\n');
export const readStdout=`import {readFileSync} from 'node:fs';\nconst stdout=readFileSync(new URL('${stdoutFile}',import.meta.url),'utf8');\n`;
export const printsStdout=`${readStdout}process.stdout.write(stdout);\n`;

export async function writeFakePi(dir:string,source:string,files:Record<string,string>={}){
 const entry=join(dir,'fake-pi.ts');
 await writeFile(entry,source);
 for(const [name,text] of Object.entries(files))await writeFile(join(dir,name),text);
 return entry;
}
