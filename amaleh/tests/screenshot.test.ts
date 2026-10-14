import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshot, screenshotOptions } from '../scripts/screenshot.ts';
import { decodePng } from '../scripts/png.ts';

test('screenshot options come from the render check environment unless a flag overrides them',()=>{
 const render=join(tmpdir(),'runs','render.png'),env={AMALEH_RENDER:render,AMALEH_RENDER_WIDTH:'480',AMALEH_RENDER_HEIGHT:'340'};
 assert.deepEqual(screenshotOptions(['card.html'],env),{page:'card.html',out:render,width:480,height:340});
 assert.deepEqual(screenshotOptions(['card.html','--width','600','--out','shot.png'],env).width,600);
 assert.deepEqual([screenshotOptions(['card.html','--out','shot.png'],{}).width,screenshotOptions(['card.html','--out','shot.png'],{}).height],[1280,800]);
 assert.throws(()=>screenshotOptions(['card.html'],{}),/No output path: pass --out, or run inside a render check/);
 assert.throws(()=>screenshotOptions(['a.html','b.html'],env),/Usage: screenshot\.ts/);
 assert.throws(()=>screenshotOptions(['card.html','--height'],env),/--height needs a value/);
 assert.throws(()=>screenshotOptions(['card.html'],{...env,AMALEH_RENDER_WIDTH:'wide'}),/AMALEH_RENDER_WIDTH must be a whole number of pixels from 1 to 8000, not wide/);
});

test('a screenshot of a local page is a complete PNG at the requested size, and a missing page fails before any browser starts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amaleh-screenshot-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const page=join(dir,'page.html'),out=join(dir,'shot.png');
 await writeFile(page,'<!doctype html><body style="margin:0;background:#F59E0B"></body>');
 await writeFile(out,'stale');
 assert.deepEqual(await screenshot({page,out,width:200,height:120}),{width:200,height:120});
 const shot=decodePng(await readFile(out))!;
 assert.deepEqual(Array.from(shot.rgba.subarray(0,4)),[245,158,11,255]);
 await assert.rejects(()=>screenshot({page:join(dir,'missing.html'),out,width:200,height:120}),/Page .*missing\.html does not exist/);
});
