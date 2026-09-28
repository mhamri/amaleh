import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { family } from '../scripts/family.ts';
import { family as reexported } from '../scripts/core.ts';

const models=JSON.parse(readFileSync(fileURLToPath(new URL('../models.json',import.meta.url)),'utf8')) as { flash:string[]; deep:string[]; jev:string };

test('every model in the pool resolves to a family',()=>{
 for(const id of [...models.flash,...models.deep,models.jev]){
  const resolved=family(id);
  assert.ok(resolved.length>0,`${id} resolves to no family`);
  assert.ok(!resolved.startsWith('~'),`${id} resolves to the family '${resolved}', which keeps the alias marker`);
 }
 assert.equal(family(models.jev),'jev','the decision model is one family whatever its alias');
 assert.deepEqual(models.deep.map(family),['kimi'],'the repair model is the deeper family');
});

test('the routed families keep the names the runtime has always returned',()=>{
 assert.equal(family('~deepseek/deepseek-flash-latest'),'deepseek');
 assert.equal(family('deepseek/deepseek-v4.1-flash'),'deepseek');
 assert.equal(family('~z-ai/glm-flash-latest'),'glm');
 assert.equal(family('xiaomi/mimo-v2.6-flash'),'xiaomi');
 assert.equal(family('xiaomi/mimo-v2.5'),'xiaomi');
 assert.equal(family('stealth/space-bunny-alpha'),'stealth');
 assert.equal(family('moonshotai/kimi-k3'),'kimi');
 assert.equal(family('anthropic/claude-opus-5-5'),'claude');
 assert.equal(family('openai/gpt-6'),'openai');
 assert.equal(family('upstage/solar-pro4'),'upstage');
});

test('the decision model is its own family under any id',()=>{
 assert.equal(family('~typesafe/jev-latest'),'jev');
 assert.equal(family('typesafe/jev-router'),'jev');
 assert.equal(family('typesafe/jev-router:free'),'jev');
});

test('an alias id shares the family of the exact id it points at',()=>{
 assert.equal(family('~acme/foo-latest'),family('acme/foo-1'));
 assert.equal(family('~upstage/solar-pro4'),family('upstage/solar-pro4'));
 assert.equal(family('~stealth/space-bunny-alpha'),family('stealth/space-bunny-alpha'));
});

test('core re-exports the one definition of family',()=>{
 assert.equal(reexported,family);
});
