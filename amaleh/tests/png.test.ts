import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePng, describePalette, hexDistance, isPng, meanDifference, measuredPalette, pairedShapes, pictureShapes, pngSize } from '../scripts/png.ts';
import { cardBars, cardPng, cardText, encodePng, solidPng, type PngSpec } from './png-fixture.ts';

const pixelAt=(rgba:Uint8Array,width:number,x:number,y:number)=>Array.from(rgba.subarray((y*width+x)*4,(y*width+x)*4+4));
function decodesTo(spec:PngSpec,expected:(x:number,y:number)=>number[]){
 const decoded=decodePng(encodePng(spec));
 assert.ok(decoded,'the picture decodes');
 assert.deepEqual([decoded.width,decoded.height],[spec.width,spec.height]);
 for(let y=0;y<spec.height;y++)for(let x=0;x<spec.width;x++)assert.deepEqual(pixelAt(decoded.rgba,spec.width,x,y),expected(x,y),`pixel ${x},${y}`);
}

test('every PNG color type and bit depth decodes to the same RGBA pixels, through all five row filters',()=>{
 decodesTo({width:7,height:5,colorType:6,depth:8,sample:(x,y)=>[x*30,y*50,x*y*7,255-x*10]},(x,y)=>[x*30,y*50,x*y*7,255-x*10]);
 decodesTo({width:6,height:4,colorType:2,depth:16,sample:(x,y)=>[x*10000,y*15000,65535-x*1000]},(x,y)=>[(x*10000)>>8,(y*15000)>>8,(65535-x*1000)>>8,255]);
 decodesTo({width:11,height:3,colorType:0,depth:1,sample:(x,y)=>[(x+y)%2]},(x,y)=>{const v=(x+y)%2?255:0;return [v,v,v,255];});
 decodesTo({width:9,height:3,colorType:0,depth:2,sample:x=>[x%4]},x=>{const v=Math.round((x%4)*255/3);return [v,v,v,255];});
 decodesTo({width:5,height:5,colorType:4,depth:8,sample:(x,y)=>[x*40,y*60]},(x,y)=>[x*40,x*40,x*40,y*60]);
});

test('palette pictures read their colors and transparency from PLTE and tRNS',()=>{
 const palette=[[255,0,0],[0,128,255],[16,185,129]];
 decodesTo({width:5,height:3,colorType:3,depth:4,palette,transparency:[255,128],sample:x=>[x%3]},x=>[...palette[x%3],x%3===0?255:x%3===1?128:255]);
});

test('a tRNS color key makes exactly the matching gray or RGB pixels transparent',()=>{
 decodesTo({width:4,height:2,colorType:0,depth:8,transparency:[0,200],sample:x=>[x===2?200:x*10]},x=>x===2?[200,200,200,0]:[x*10,x*10,x*10,255]);
 decodesTo({width:3,height:2,colorType:2,depth:8,transparency:[0,1,0,2,0,3],sample:x=>x===1?[1,2,3]:[9,9,9]},x=>x===1?[1,2,3,0]:[9,9,9,255]);
});

test('an Adam7 interlaced picture puts every pass back at its own pixels',()=>{
 for(const [width,height] of [[13,11],[1,1],[3,9]] as const)
  decodesTo({width,height,colorType:2,depth:8,interlace:true,sample:(x,y)=>[x*17&255,y*23&255,(x+y)*5&255]},(x,y)=>[x*17&255,y*23&255,(x+y)*5&255,255]);
});

test('a cut-off or foreign file is not a picture, and the size is read from the header alone',()=>{
 const bytes=solidPng(40,30,()=>[10,20,30]);
 assert.equal(isPng(bytes),true);
 assert.deepEqual(pngSize(bytes),{width:40,height:30});
 assert.equal(decodePng(bytes.subarray(0,bytes.length-30)),undefined,'a truncated file never decodes');
 assert.equal(decodePng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),undefined);
 assert.equal(pngSize(Buffer.from('GIF89a')),undefined);
});

test('the measured palette lists the main colors by area and keeps only bright saturated accents',()=>{
 const picture=decodePng(solidPng(100,100,(x,y)=>y<70?[15,23,42]:y<95?[100,116,139]:x<50?[245,158,11]:[56,189,248]))!;
 const palette=measuredPalette(picture);
 assert.deepEqual(palette.main.map(s=>[s.hex,s.share]),[['#0F172A',0.7],['#64748B',0.25],['#F59E0B',0.025],['#38BDF8',0.025]]);
 assert.deepEqual(palette.accents.map(s=>s.hex),['#F59E0B','#38BDF8'],'the dark and gray surfaces are not accents');
 assert.match(describePalette(palette),/^main colors by area: #0F172A 70\.0%, #64748B 25\.0%.*; accent colors: #F59E0B 2\.5%, #38BDF8 2\.5%$/);
});

test('the mean difference is zero for the same picture and unmeasured for a different size',()=>{
 const a=decodePng(solidPng(20,20,()=>[0,0,0]))!,b=decodePng(solidPng(20,20,(x)=>x<10?[0,0,0]:[255,255,255]))!;
 assert.equal(meanDifference(a,a),0);
 assert.equal(meanDifference(a,b),127.5);
 assert.equal(meanDifference(a,decodePng(solidPng(20,21,()=>[0,0,0]))!),undefined);
 assert.equal(hexDistance('#000000','#000304'),5);
});

test('the solid elements of a picture are its one-color areas with their boxes, and its text lines are rows of small marks with their ink color',()=>{
 const {solids,texts}=pictureShapes(decodePng(cardPng())!);
 assert.deepEqual(solids.map(r=>[r.hex,r.x,r.y,r.width,r.height]).sort(),[['#1E293B',10,10,120,80],['#38BDF8',20,50,20,30],['#38BDF8',50,40,20,40]],'the thin amber cross and the background frame fill too little of their boxes');
 assert.equal(solids.find(r=>r.hex==='#38BDF8'&&r.x===20)!.area,600);
 assert.deepEqual(texts.map(r=>[r.hex,r.x,r.y,r.width,r.height,r.area]),[['#F8FAFC',20,20,16,8,96]],'three marks two pixels apart are one line, and the large amber cross is not text');
});

test('solid elements pair by nearest center only when a color has the same count in both pictures, and each text line pairs with the marks near its place',()=>{
 const design=decodePng(cardPng())!,moved=decodePng(cardPng([{...cardBars[0],width:16},{...cardBars[1],y:46,height:34}],{...cardText,y:26,color:[100,116,139]}))!;
 const shapes=pairedShapes(design,moved),blue=shapes.solids.find(g=>g.hex==='#38BDF8')!;
 assert.deepEqual(blue.pairs.map(([d,b])=>[d.x,d.width,b.x,b.width,b.y]).sort(),[[20,20,20,16,50],[50,20,50,20,46]]);
 assert.deepEqual(shapes.texts.pairs.map(([d,b])=>[d.hex,d.y,b.hex,b.y]),[['#F8FAFC',20,'#64748B',26]]);
 const merged=decodePng(cardPng([{x:20,y:50,width:50,height:30}],{...cardText,x:90,y:70}))!;
 const paired=pairedShapes(design,merged),unpaired=paired.solids.find(g=>g.hex==='#38BDF8')!;
 assert.deepEqual([unpaired.design.length,unpaired.built.length,unpaired.pairs.length],[2,1,0],'two bars that merged into one are not paired with either');
 assert.equal(paired.solids.find(g=>g.hex==='#1E293B')!.pairs.length,1);
 assert.deepEqual([paired.texts.design.length,paired.texts.pairs.length],[1,0],'marks far from the line are not its text');
});
