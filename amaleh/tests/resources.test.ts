import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../scripts/core.ts';
import { resourcesOverlap } from '../scripts/resources.ts';

const owning=(workspace:string,resources:string[])=>({workspace,resources} as c.Task);

test('a glob overlaps every path under the directory it matches in',()=>{
 assert.ok(resourcesOverlap('website/src/**','website/src/lib/x.ts'));
 assert.ok(resourcesOverlap('website/src/lib/x.ts','website/src/**'));
 assert.ok(resourcesOverlap('website/**/*.md','website/DESIGN-SYSTEM.md'));
 assert.ok(resourcesOverlap('**/*.md','amaleh/SKILL.md'),'a glob that can match anywhere overlaps everything');
 assert.ok(resourcesOverlap('website/src/*.css','website/src'),'a bare directory owns the files a glob matches inside it');
 assert.ok(resourcesOverlap('website/src/**','website/src/components/**'));
});

test('resources in separate directories never overlap',()=>{
 assert.ok(!resourcesOverlap('website/src/**','website/scripts/**'));
 assert.ok(!resourcesOverlap('website/src/**','website/DESIGN-SYSTEM.md'));
 assert.ok(!resourcesOverlap('website/src','website/srcx/a.ts'));
 assert.ok(!resourcesOverlap('amaleh/scripts/core.ts','amaleh/scripts/delegate.ts'));
});

test('spellings of one path overlap: case, backslashes, ./ and duplicate slashes; .. matches everything',()=>{
 assert.ok(resourcesOverlap('SRC/**','src/app.ts'));
 assert.ok(resourcesOverlap('website\\src\\**','website/src/lib/x.ts'));
 assert.ok(resourcesOverlap('./website//src/a.ts','website/src/a.ts'));
 assert.ok(resourcesOverlap('website/src/','website/src/a.ts'));
 assert.ok(resourcesOverlap('website/../amaleh/scripts/core.ts','website/src/a.ts'));
 assert.ok(!resourcesOverlap('./website/src/**','./amaleh/scripts/**'));
});

test('plain paths keep their subtree ownership',()=>{
 assert.ok(resourcesOverlap('docs','docs/contract.md'));
 assert.ok(resourcesOverlap('*','anything'));
 assert.ok(resourcesOverlap('a.ts','a.ts'));
});

test('two live tasks whose globs share a file conflict',()=>{
 assert.ok(c.conflict(owning('A',['website/src/**']),owning('B',['website/src/lib/x.ts'])));
 assert.ok(!c.conflict(owning('A',['website/src/**']),owning('B',['website/scripts/check.mjs'])));
});
