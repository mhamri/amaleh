import { deflateSync } from 'node:zlib';

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
const crc=(bytes:Uint8Array)=>{let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
const channelsOf:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
const adam7=[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];

function chunk(type:string,body:Uint8Array){
 const out=Buffer.alloc(12+body.length);
 out.writeUInt32BE(body.length,0);out.write(type,4,'latin1');Buffer.from(body).copy(out,8);
 out.writeUInt32BE(crc(out.subarray(4,8+body.length)),8+body.length);
 return out;
}
function paeth(left:number,up:number,upLeft:number){const p=left+up-upLeft,pa=Math.abs(p-left),pb=Math.abs(p-up),pc=Math.abs(p-upLeft);return pa<=pb&&pa<=pc?left:pb<=pc?up:upLeft;}
function filtered(type:number,row:Uint8Array,previous:Uint8Array|undefined,bpp:number){
 const out=new Uint8Array(row.length+1);out[0]=type;
 for(let x=0;x<row.length;x++){
  const left=x>=bpp?row[x-bpp]:0,up=previous?previous[x]:0,upLeft=previous&&x>=bpp?previous[x-bpp]:0;
  const predictor=type===1?left:type===2?up:type===3?(left+up)>>1:type===4?paeth(left,up,upLeft):0;
  out[x+1]=(row[x]-predictor)&255;
 }
 return out;
}
function packedRow(samples:number[][],depth:number){
 if(depth===16)return Uint8Array.from(samples.flat().flatMap(v=>[v>>8,v&255]));
 if(depth===8)return Uint8Array.from(samples.flat());
 const values=samples.flat(),out=new Uint8Array(Math.ceil(values.length*depth/8));
 values.forEach((v,i)=>{const bit=i*depth;out[bit>>3]|=v<<(8-depth-(bit&7));});
 return out;
}

export type PngSpec={width:number;height:number;colorType:0|2|3|4|6;depth:1|2|4|8|16;interlace?:boolean;palette?:number[][];transparency?:number[];sample:(x:number,y:number)=>number[]};
export function encodePng(spec:PngSpec){
 const channels=channelsOf[spec.colorType],bpp=Math.max(1,(channels*spec.depth)>>3),rows:Uint8Array[]=[];
 let rowNumber=0;
 for(const [x0,y0,dx,dy] of spec.interlace?adam7:[[0,0,1,1]]){
  const passWidth=Math.ceil((spec.width-x0)/dx),passHeight=Math.ceil((spec.height-y0)/dy);
  if(passWidth<=0||passHeight<=0)continue;
  let previous:Uint8Array|undefined;
  for(let y=0;y<passHeight;y++){
   const row=packedRow(Array.from({length:passWidth},(_,x)=>spec.sample(x0+x*dx,y0+y*dy)),spec.depth);
   rows.push(filtered(rowNumber++%5,row,previous,bpp));previous=row;
  }
 }
 const header=Buffer.alloc(13);
 header.writeUInt32BE(spec.width,0);header.writeUInt32BE(spec.height,4);header[8]=spec.depth;header[9]=spec.colorType;header[12]=spec.interlace?1:0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
  ...(spec.palette?[chunk('PLTE',Uint8Array.from(spec.palette.flat()))]:[]),
  ...(spec.transparency?[chunk('tRNS',Uint8Array.from(spec.transparency))]:[]),
  chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',new Uint8Array())]);
}
export const solidPng=(width:number,height:number,color:(x:number,y:number)=>[number,number,number])=>encodePng({width,height,colorType:2,depth:8,sample:color});

export type CardBar={x:number;y:number;width:number;height:number};
export type CardText={x:number;y:number;height:number;color:[number,number,number]};
export const cardBars:CardBar[]=[{x:20,y:50,width:20,height:30},{x:50,y:40,width:20,height:40}];
export const cardText:CardText={x:20,y:20,height:8,color:[248,250,252]};
const inside=(b:CardBar,x:number,y:number)=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height;
const inLetter=(t:CardText,x:number,y:number)=>y>=t.y&&y<t.y+t.height&&x>=t.x&&x<t.x+16&&(x-t.x)%6<4;
const thinCross=(x:number,y:number)=>(x>=163&&x<167&&y>=20&&y<80)||(y>=48&&y<52&&x>=135&&x<195);
export const cardPng=(bars:CardBar[]=cardBars,text:CardText=cardText)=>solidPng(200,100,(x,y)=>bars.some(b=>inside(b,x,y))?[56,189,248]:inLetter(text,x,y)?text.color:x>=10&&x<130&&y>=10&&y<90?[30,41,59]:thinCross(x,y)?[245,158,11]:[15,23,42]);
