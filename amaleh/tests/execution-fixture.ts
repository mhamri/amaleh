// Synthetic durable routing evidence for offline lifecycle fixtures only.
import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import * as c from '../scripts/core.ts';
import {scopeKey} from '../scripts/routing.ts';
export const clearCut:c.ShapeInput={understanding:'Synthetic fixture request',clearCut:'A synthetic test fixture has exactly one reading'};
type GateAnswers={course?:string;progress?:string;findings?:string};
export const jevGate=(answers:GateAnswers={},seen?:any[])=>(async(_url:any,init:any)=>{
 const body=JSON.parse(init.body);seen?.push(body);
 const pick=(key:string)=>key==='course'?answers.course??'targeted':key==='progress'?answers.progress??'new':answers.findings??'fix-here';
 return Response.json({model:'test/jev',answers:Object.fromEntries(Object.entries(body.questions as Record<string,{criteria:Record<string,string>}>).map(([key,q])=>{const options=Object.keys(q.criteria),choice=pick(key);return [key,{type:'choice',choice,confidence:.95,probabilities:Object.fromEntries(options.map(o=>[o,o===choice?.95:.05/(options.length-1)]))}];}))});
}) as typeof fetch;
export const noJev=(async()=>{throw new Error('This fixture has no Jev answer; the test must not reach the network');}) as unknown as typeof fetch;
export async function fixtureClaim(store:c.Store,id:string,input:Parameters<typeof c.claim>[2]){
 const initial=await store.load(),t=c.taskOf(initial,id);
 if(t.depth==='host'&&input.model===initial.host.model){const grant=await c.hostException(store,{id,reason:'repair-escalation',evidence:'Synthetic exhausted-repair fixture'});return c.claim(store,id,{...input,hostAuthorization:grant.authorization});}
 const workspace=await realpath(input.workspace),decisionId='fixture-'+randomUUID();
 await store.transaction(s=>{const scope={taskId:id,purpose:'worker' as const,workspace,request:{}};s.decisions.push({id:decisionId,question:'Synthetic test-only worker selection',criteria:{selected:input.model},choice:'selected',source:'synthetic-fixture',revision:s.revision,state:{routing:{scope,key:scopeKey(s,scope),models:{selected:input.model}}}});});
 return c.claim(store,id,{...input,routeDecisionId:decisionId});
}
