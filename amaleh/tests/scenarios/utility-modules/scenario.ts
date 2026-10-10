import type { Scenario } from '../bench.ts';

type Unit = { id:string; title:string; goal:string; module:string; criteria:string[]; spec:string };

const units:Unit[] = [
 {id:'slugify',title:'URL slug',module:'slugify.ts',goal:'Export slugify(input) turning arbitrary text into a lowercase hyphen-separated URL slug',
  criteria:['Every case in spec.test.ts passes','Only slugify.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slugify } from './slugify.ts';\ntest('lowercases and hyphenates',()=>{assert.equal(slugify('Hello World'),'hello-world');});\ntest('strips punctuation',()=>{assert.equal(slugify('Caf\\u00e9 & Bar!'),'cafe-bar');});\ntest('collapses runs of separators',()=>{assert.equal(slugify('  a---b  c '),'a-b-c');});\ntest('returns empty string for no usable characters',()=>{assert.equal(slugify('!!!'),'');});\n`},
 {id:'chunk',title:'Array chunking',module:'chunk.ts',goal:'Export chunk(items,size) splitting an array into consecutive groups of at most size',
  criteria:['Every case in spec.test.ts passes','Only chunk.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { chunk } from './chunk.ts';\ntest('splits evenly',()=>{assert.deepEqual(chunk([1,2,3,4],2),[[1,2],[3,4]]);});\ntest('keeps a short final group',()=>{assert.deepEqual(chunk([1,2,3],2),[[1,2],[3]]);});\ntest('returns no groups for an empty array',()=>{assert.deepEqual(chunk([],3),[]);});\ntest('rejects a size below one',()=>{assert.throws(()=>chunk([1],0));});\n`},
 {id:'duration',title:'Duration parsing',module:'duration.ts',goal:'Export parseDuration(text) converting a compact duration such as 1h30m into milliseconds',
  criteria:['Every case in spec.test.ts passes','Only duration.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseDuration } from './duration.ts';\ntest('reads a single unit',()=>{assert.equal(parseDuration('90s'),90000);});\ntest('sums several units',()=>{assert.equal(parseDuration('1h30m'),5400000);});\ntest('supports days and milliseconds',()=>{assert.equal(parseDuration('2d500ms'),172800500);});\ntest('rejects unparseable text',()=>{assert.throws(()=>parseDuration('soon'));});\n`},
 {id:'bytes',title:'Byte formatting',module:'bytes.ts',goal:'Export formatBytes(count) rendering a byte count with a binary unit suffix',
  criteria:['Every case in spec.test.ts passes','Only bytes.ts is created or changed'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatBytes } from './bytes.ts';\ntest('leaves small counts in bytes',()=>{assert.equal(formatBytes(512),'512 B');});\ntest('uses one decimal place for kibibytes',()=>{assert.equal(formatBytes(1536),'1.5 KB');});\ntest('drops a trailing zero decimal',()=>{assert.equal(formatBytes(1048576),'1 MB');});\ntest('rejects a negative count',()=>{assert.throws(()=>formatBytes(-1));});\n`},
 {id:'truncate',title:'Text truncation',module:'truncate.ts',
  goal:'Export truncate(text,limit) shortening text to at most limit characters, ending the shortened result with the single ellipsis character …. Whether to cut at a word boundary or mid-word is a real product trade-off that spec.test.ts deliberately leaves open: a word boundary reads better but can waste most of the budget on one long word. This has no single right answer, so consult the Jev helper before choosing and state the choice and its reason in your result',
  criteria:['Every case in spec.test.ts passes','Only truncate.ts is created or changed','The word-boundary choice was taken through the Jev helper and its reason is stated in the result'],
  spec:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { truncate } from './truncate.ts';\ntest('leaves text within the limit untouched',()=>{assert.equal(truncate('hello',10),'hello');});\ntest('leaves text exactly at the limit untouched',()=>{assert.equal(truncate('abc',3),'abc');});\ntest('never exceeds the limit and marks the cut',()=>{const out=truncate('the quick brown fox',10);assert.ok(out.length<=10,out+' exceeds 10 characters');assert.ok(out.endsWith('\\u2026'),out+' does not end with an ellipsis');});\ntest('rejects a limit below one',()=>{assert.throws(()=>truncate('x',0));});\n`}];

const scenario:Scenario={
 intent:'Benchmark Amaleh delegation: five independent utility modules, each proven by a pre-written test file',
 criteria:['Every delegated module passes every case in its own spec.test.ts, with no spec file edited',
  'Each module is delivered in its own isolated workspace and accepted only after an independent review by another model family'],
 constraints:['Do not edit any spec.test.ts','Create only the named module in each workspace'],
 fixtures:Object.fromEntries(units.map(u=>[`${u.id}/spec.test.ts`,u.spec])),
 tasks:()=>units.map(unit=>({id:unit.id,title:unit.title,goal:`${unit.goal}. The file spec.test.ts already exists and must not be edited; create ${unit.module} beside it so every case passes.`,
  phase:'bench',deps:[],resources:[unit.module],criteria:unit.criteria,kind:'code',checks:[{id:'spec',command:'bun',args:['test','spec.test.ts'],role:'probe'}]})),
 verdict:async({health})=>{
  const jevCalls=Number(health.metrics.workerJevCalls??0),families=Object.keys(health.metrics.workerFamilies??{});
  return [
   {name:'worker-side Jev calls',value:String(jevCalls),pass:jevCalls>0},
   {name:'model families used',value:families.join(', ')||'none',pass:families.length>=2}];
 },
};
export default scenario;
