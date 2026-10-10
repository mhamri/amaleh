import { inflateSync } from 'node:zlib';

export type Pixels={width:number;height:number;rgba:Uint8Array};
export type Swatch={hex:string;share:number};
export type MeasuredPalette={main:Swatch[];accents:Swatch[]};
export type Box={x:number;y:number;width:number;height:number};
export type Region=Box&{hex:string;area:number};
export type RegionPairs={hex:string;design:Region[];built:Region[];pairs:[Region,Region][]};
export type ShapePairs={solids:RegionPairs[];texts:{design:Region[];pairs:[Region,Region][]}};

const signature=[137,80,78,71,13,10,26,10];
const channelsOf:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
const depthsOf:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
const adam7=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];

export function isPng(bytes:Uint8Array){return bytes.length>=8&&signature.every((b,i)=>bytes[i]===b);}

export function pngSize(bytes:Uint8Array){
 if(!isPng(bytes)||bytes.length<24)return undefined;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 return {width:view.getUint32(16),height:view.getUint32(20)};
}

function paeth(left:number,up:number,upLeft:number){
 const p=left+up-upLeft,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-upLeft);
 return pa<=pb&&pa<=pc?left:pb<=pc?up:upLeft;
}
function unfilter(data:Uint8Array,height:number,stride:number,bpp:number){
 const out=new Uint8Array(height*stride);
 for(let y=0;y<height;y++){
  const type=data[y*(stride+1)],row=data.subarray(y*(stride+1)+1,(y+1)*(stride+1)),at=y*stride;
  for(let x=0;x<stride;x++){
   const left=x>=bpp?out[at+x-bpp]:0,up=y?out[at-stride+x]:0,upLeft=y&&x>=bpp?out[at-stride+x-bpp]:0;
   const predictor=type===1?left:type===2?up:type===3?(left+up)>>1:type===4?paeth(left,up,upLeft):0;
   out[at+x]=(row[x]+predictor)&255;
  }
 }
 return out;
}
export function decodePng(bytes:Uint8Array):Pixels|undefined{
 if(!isPng(bytes))return undefined;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let width=0,height=0,depth=0,colorType=0,interlace=0,palette:Uint8Array|undefined,transparency:Uint8Array|undefined;
 const idat:Uint8Array[]=[];
 for(let at=8;at+8<=bytes.length;){
  const length=view.getUint32(at),type=String.fromCharCode(...bytes.subarray(at+4,at+8)),body=bytes.subarray(at+8,at+8+length);
  if(type==='IHDR'){width=view.getUint32(at+8);height=view.getUint32(at+12);depth=bytes[at+16];colorType=bytes[at+17];interlace=bytes[at+20];}
  else if(type==='PLTE')palette=body;
  else if(type==='tRNS')transparency=body;
  else if(type==='IDAT')idat.push(body);
  else if(type==='IEND')break;
  at+=12+length;
 }
 const channels=channelsOf[colorType];
 if(!width||!height||!channels||!depthsOf[colorType].includes(depth)||interlace>1||(colorType===3&&!palette))return undefined;
 let data:Uint8Array;
 try{data=inflateSync(Buffer.concat(idat));}catch{return undefined;}
 const bitsPerPixel=channels*depth,bpp=Math.max(1,bitsPerPixel>>3),highest=(1<<depth)-1;
 const transparentKey=transparency&&(colorType===0||colorType===2)?Array.from({length:channels},(_,c)=>(transparency![c*2]<<8)|transparency![c*2+1]):undefined;
 const rgba=new Uint8Array(width*height*4);
 let offset=0;
 for(const [x0,y0,dx,dy] of interlace?adam7:[[0,0,1,1]]){
  const passWidth=Math.ceil((width-x0)/dx),passHeight=Math.ceil((height-y0)/dy);
  if(passWidth<=0||passHeight<=0)continue;
  const stride=Math.ceil(passWidth*bitsPerPixel/8),size=passHeight*(stride+1);
  if(offset+size>data.length)return undefined;
  const rows=unfilter(data.subarray(offset,offset+size),passHeight,stride,bpp);
  offset+=size;
  for(let y=0;y<passHeight;y++)for(let x=0;x<passWidth;x++){
   const sample=(c:number)=>{
    if(depth===16){const at=y*stride+x*bpp+c*2;return (rows[at]<<8)|rows[at+1];}
    if(depth===8)return rows[y*stride+x*bpp+c];
    const bit=x*bitsPerPixel+c*depth;return (rows[y*stride+(bit>>3)]>>(8-depth-(bit&7)))&highest;
   };
   const eight=(v:number)=>depth===16?v>>8:depth===8?v:Math.round(v*255/highest);
   const raw=Array.from({length:channels},(_,c)=>sample(c));
   let r,g,b,a=255;
   if(colorType===3){const index=raw[0];r=palette![index*3]??0;g=palette![index*3+1]??0;b=palette![index*3+2]??0;a=transparency&&index<transparency.length?transparency[index]:255;}
   else if(colorType===0||colorType===4){r=g=b=eight(raw[0]);if(colorType===4)a=eight(raw[1]);}
   else{r=eight(raw[0]);g=eight(raw[1]);b=eight(raw[2]);if(colorType===6)a=eight(raw[3]);}
   if(transparentKey&&transparentKey.every((v,c)=>v===raw[c]))a=0;
   rgba.set([r,g,b,a],((y0+y*dy)*width+x0+x*dx)*4);
  }
 }
 return {width,height,rgba};
}

const hex=(r:number,g:number,b:number)=>'#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase();
const sampleStep=(p:Pixels)=>Math.max(1,Math.floor(Math.sqrt(p.width*p.height/250000)));
const nearColor=28,smallestShare=.001;
const mainColors=6,accentColors=8,accentSaturation=.33,accentBrightness=90,distinctAccent=60;
type Group={r:number;g:number;b:number;n:number};
const meanOf=(g:Group)=>[g.r/g.n,g.g/g.n,g.b/g.n] as const;
const distance=(a:Group,b:Group)=>Math.hypot(...meanOf(a).map((v,i)=>v-meanOf(b)[i]));
const swatch=(g:Group,counted:number):Swatch=>({hex:hex(...meanOf(g)),share:Math.round(g.n/counted*1000)/1000});
function colorGroups(p:Pixels){
 const step=sampleStep(p),buckets=new Map<number,Group>();
 let counted=0;
 for(let y=0;y<p.height;y+=step)for(let x=0;x<p.width;x+=step){
  const at=(y*p.width+x)*4;
  if(p.rgba[at+3]<128)continue;
  const [r,g,b]=[p.rgba[at],p.rgba[at+1],p.rgba[at+2]],key=(r>>3)<<10|(g>>3)<<5|(b>>3);
  const bucket=buckets.get(key)??{r:0,g:0,b:0,n:0};
  bucket.r+=r;bucket.g+=g;bucket.b+=b;bucket.n++;buckets.set(key,bucket);counted++;
 }
 const groups:Group[]=[];
 for(const bucket of [...buckets.values()].sort((a,b)=>b.n-a.n)){
  const near=groups.find(g=>distance(g,bucket)<=nearColor);
  if(near){near.r+=bucket.r;near.g+=bucket.g;near.b+=bucket.b;near.n+=bucket.n;}else groups.push({...bucket});
 }
 return {groups:groups.sort((a,b)=>b.n-a.n).filter(g=>g.n/counted>=smallestShare),counted};
}
const saturated=(g:Group)=>{const values=meanOf(g),high=Math.max(...values),low=Math.min(...values);return high>=accentBrightness&&(high-low)/high>=accentSaturation;};
export function measuredPalette(p:Pixels):MeasuredPalette{
 const {groups,counted}=colorGroups(p),accents:Group[]=[];
 for(const g of groups.filter(saturated))if(accents.length<accentColors&&!accents.some(a=>distance(a,g)<distinctAccent))accents.push(g);
 return {main:groups.slice(0,mainColors).map(g=>swatch(g,counted)),accents:accents.map(g=>swatch(g,counted))};
}

export function meanDifference(a:Pixels,b:Pixels){
 if(a.width!==b.width||a.height!==b.height)return undefined;
 const step=sampleStep(a);let total=0,count=0;
 for(let y=0;y<a.height;y+=step)for(let x=0;x<a.width;x+=step){
  const at=(y*a.width+x)*4;
  total+=Math.abs(a.rgba[at]-b.rgba[at])+Math.abs(a.rgba[at+1]-b.rgba[at+1])+Math.abs(a.rgba[at+2]-b.rgba[at+2]);count+=3;
 }
 return count?total/count:0;
}

const rgbOf=(color:string)=>[1,3,5].map(at=>parseInt(color.slice(at,at+2),16));
export const hexDistance=(a:string,b:string)=>Math.hypot(...rgbOf(a).map((v,i)=>v-rgbOf(b)[i]));

const regionColorsAtMost=12,regionColorDistance=40,smallestRegion=400,smallestRegionShare=.001,solidFill=.6,pairedRegionsAtMost=40;
const glyphSpan=.25,glyphsAtMost=4000,lineOverlap=.5,wordGap=.6,smallestTextLine=40,shortestTextLine=6,inkCore=.25;
const regionPalette=(p:Pixels)=>colorGroups(p).groups.slice(0,regionColorsAtMost).map(g=>hex(...meanOf(g)));
function nearestColorLabels(p:Pixels,colors:string[]){
 const rgb=colors.map(rgbOf),labels=new Int16Array(p.width*p.height).fill(-1),farthest=regionColorDistance**2;
 for(let i=0;i<labels.length;i++){
  if(p.rgba[i*4+3]<128)continue;
  let best=-1,bestDistance=farthest;
  for(let c=0;c<rgb.length;c++){const dr=p.rgba[i*4]-rgb[c][0],dg=p.rgba[i*4+1]-rgb[c][1],db=p.rgba[i*4+2]-rgb[c][2],d=dr*dr+dg*dg+db*db;if(d<=bestDistance&&(best<0||d<bestDistance)){best=c;bestDistance=d;}}
  labels[i]=best;
 }
 return labels;
}
type Patch=Box&{kind:number;pixels:Int32Array};
const fourWay=[[-1,0],[1,0],[0,-1],[0,1]],eightWay=[...fourWay,[-1,-1],[1,-1],[-1,1],[1,1]];
function patches(p:Pixels,kinds:Int16Array,steps:number[][]):Patch[]{
 const {width,height}=p,seen=new Uint8Array(kinds.length),stack=new Int32Array(kinds.length),found:Patch[]=[];
 for(let start=0;start<kinds.length;start++){
  const kind=kinds[start];
  if(kind<0||seen[start])continue;
  let top=0,left=width,right=-1,upper=height,lower=-1;
  const pixels:number[]=[];
  seen[start]=1;stack[top++]=start;
  while(top){
   const i=stack[--top],x=i%width,y=(i-x)/width;pixels.push(i);
   if(x<left)left=x;if(x>right)right=x;if(y<upper)upper=y;if(y>lower)lower=y;
   for(const [dx,dy] of steps){
    const nx=x+dx,ny=y+dy,n=ny*width+nx;
    if(nx>=0&&ny>=0&&nx<width&&ny<height&&!seen[n]&&kinds[n]===kind){seen[n]=1;stack[top++]=n;}
   }
  }
  found.push({kind,x:left,y:upper,width:right-left+1,height:lower-upper+1,pixels:Int32Array.from(pixels)});
 }
 return found;
}
const contains=(outer:Box,inner:Box)=>outer.x<=inner.x&&outer.y<=inner.y&&outer.x+outer.width>=inner.x+inner.width&&outer.y+outer.height>=inner.y+inner.height;
const backgroundOf=(glyph:Box,solids:Region[])=>solids.filter(s=>contains(s,glyph)).sort((a,b)=>a.area-b.area)[0];
function inkColor(p:Pixels,pixels:number[],background:string){
 const [br,bg,bb]=rgbOf(background),far=pixels.map(i=>({i,d:(p.rgba[i*4]-br)**2+(p.rgba[i*4+1]-bg)**2+(p.rgba[i*4+2]-bb)**2})).sort((a,b)=>b.d-a.d);
 const core=far.slice(0,Math.max(1,Math.ceil(far.length*inkCore))),mean=(c:number)=>core.reduce((n,f)=>n+p.rgba[f.i*4+c],0)/core.length;
 return hex(mean(0),mean(1),mean(2));
}
function textLines(p:Pixels,glyphs:Patch[],solids:Region[],page:string):Region[]{
 const grounds=glyphs.map(g=>backgroundOf(g,solids));
 const owner=glyphs.map((_,i)=>i),root=(i:number):number=>owner[i]===i?i:(owner[i]=root(owner[i]));
 for(let i=0;i<glyphs.length;i++)for(let j=i+1;j<glyphs.length;j++){
  const a=glyphs[i],b=glyphs[j];
  if(grounds[i]!==grounds[j])continue;
  const overlap=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y),gap=Math.max(a.x,b.x)-Math.min(a.x+a.width,b.x+b.width);
  if(overlap>=lineOverlap*Math.min(a.height,b.height)&&gap<=wordGap*Math.max(a.height,b.height))owner[root(i)]=root(j);
 }
 const lines=new Map<number,number[]>();
 glyphs.forEach((_,i)=>{const r=root(i),line=lines.get(r);if(line)line.push(i);else lines.set(r,[i]);});
 return [...lines.values()].map(members=>{
  const parts=members.map(i=>glyphs[i]),pixels=parts.flatMap(g=>[...g.pixels]),x=Math.min(...parts.map(g=>g.x)),y=Math.min(...parts.map(g=>g.y));
  return {hex:inkColor(p,pixels,grounds[members[0]]?.hex??page),x,y,width:Math.max(...parts.map(g=>g.x+g.width))-x,height:Math.max(...parts.map(g=>g.y+g.height))-y,area:pixels.length};
 });
}
function shapesOf(p:Pixels,colors:string[]){
 const labels=nearestColorLabels(p,colors),least=Math.max(smallestRegion,p.width*p.height*smallestRegionShare);
 const large=patches(p,labels,fourWay).filter(a=>a.pixels.length>=least);
 const solids:Region[]=large.filter(a=>a.pixels.length/(a.width*a.height)>=solidFill).map(a=>({hex:colors[a.kind],x:a.x,y:a.y,width:a.width,height:a.height,area:a.pixels.length}));
 const ink=new Int16Array(labels.length);
 for(let i=0;i<ink.length;i++)if(p.rgba[i*4+3]<128)ink[i]=-1;
 for(const a of large)for(const i of a.pixels)ink[i]=-1;
 const glyphs=patches(p,ink,eightWay).filter(g=>g.width<p.width*glyphSpan&&g.height<p.height*glyphSpan);
 return {solids,texts:glyphs.length>glyphsAtMost?[]:textLines(p,glyphs,solids,colors[0]??'#FFFFFF').filter(measurableText)};
}
const measurableText=(line:Region)=>line.area>=smallestTextLine&&line.height>=shortestTextLine;
export const pictureShapes=(p:Pixels)=>shapesOf(p,regionPalette(p));

const centerGap=(a:Box,b:Box)=>Math.hypot(a.x+a.width/2-b.x-b.width/2,a.y+a.height/2-b.y-b.height/2);
function nearestPairs(design:Region[],built:Region[]){
 const candidates=design.flatMap(d=>built.map(b=>({d,b,gap:centerGap(d,b)}))).sort((x,y)=>x.gap-y.gap),used=new Set<Region>(),pairs:[Region,Region][]=[];
 for(const {d,b} of candidates)if(!used.has(d)&&!used.has(b)){used.add(d);used.add(b);pairs.push([d,b]);}
 return pairs;
}
const reaches=(line:Region,built:Region)=>{const cx=built.x+built.width/2,cy=built.y+built.height/2;return cx>=line.x-line.height&&cx<=line.x+line.width+line.height&&cy>=line.y-line.height&&cy<=line.y+line.height*2;};
function textPairs(design:Region[],built:Region[]):[Region,Region][]{
 const owned=new Map<Region,Region[]>();
 for(const b of built){
  const owner=design.filter(d=>reaches(d,b)).sort((x,y)=>centerGap(x,b)-centerGap(y,b))[0];
  if(owner)owned.set(owner,[...owned.get(owner)??[],b]);
 }
 return design.flatMap(d=>{
  const near=owned.get(d);
  if(!near)return [];
  const x=Math.min(...near.map(b=>b.x)),y=Math.min(...near.map(b=>b.y)),largest=[...near].sort((a,b)=>b.area-a.area)[0];
  return [[d,{hex:largest.hex,x,y,width:Math.max(...near.map(b=>b.x+b.width))-x,height:Math.max(...near.map(b=>b.y+b.height))-y,area:near.reduce((n,b)=>n+b.area,0)}]];
 });
}
// See references/runtime.md#measured-elements
export function pairedShapes(design:Pixels,built:Pixels):ShapePairs{
 const colors=regionPalette(design),ours=shapesOf(design,colors),theirs=shapesOf(built,colors);
 const solids=colors.map(hex=>{
  const d=ours.solids.filter(r=>r.hex===hex),b=theirs.solids.filter(r=>r.hex===hex);
  return {hex,design:d,built:b,pairs:d.length===b.length&&d.length<=pairedRegionsAtMost?nearestPairs(d,b):[]};
 }).filter(g=>g.design.length||g.built.length);
 return {solids,texts:{design:ours.texts,pairs:textPairs(ours.texts,theirs.texts)}};
}

const listed=(swatches:Swatch[])=>swatches.length?swatches.map(s=>`${s.hex} ${(s.share*100).toFixed(1)}%`).join(', '):'none';
export const describePalette=(palette:MeasuredPalette)=>`main colors by area: ${listed(palette.main)}; accent colors: ${listed(palette.accents)}`;
