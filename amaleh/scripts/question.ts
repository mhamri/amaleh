import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, raiseContractQuestion } from './core.ts';

async function main(){
 const [workspace,runId,taskId,question,check]=process.argv.slice(2);
 if(!workspace||!runId||!taskId||!question)throw new Error('Usage: bun question.ts <run workspace> <run-id> <task-id> "<what is wrong, with the evidence>" [check-id]');
 await raiseContractQuestion(new Store(workspace,runId),{taskId,question,check:check||undefined});
 console.log(JSON.stringify({recorded:true,next:'Stop working on the part this question is about and finish your run. Do not work around it; the coordinator answers before any more work on this task.'},null,2));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
