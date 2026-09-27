const globToRegExp=(glob:string)=>{
 let pattern='';
 for(let i=0;i<glob.length;i++){
  if(glob[i]==='*'){
   if(glob[i+1]==='*'){pattern+='(?:.*/)?';i++;if(glob[i+1]==='/')i++;else pattern+='.*';}
   else pattern+='[^/]*';
  }
  else if(glob[i]==='?')pattern+='[^/]';
  else pattern+=/[.+^${}()|[\]\\]/.test(glob[i])?'\\'+glob[i]:glob[i];
 }
 return new RegExp('^'+pattern+'$');
};
const wildcard=(resource:string)=>/[*?]/.test(resource);
export function inScope(resource:string,path:string){
 if(resource==='*')return true;
 if(!wildcard(resource))return path===resource||path.startsWith(resource+'/');
 return globToRegExp(resource).test(path);
}
// Case-folded because Windows and macOS file systems usually ignore case; a
// '..' segment could point anywhere, so it matches everything.
const matchRoot=(resource:string)=>{
 const path=resource.replace(/\\/g,'/').replace(/\/{2,}/g,'/').replace(/^(?:\.\/)+/,'').replace(/\/(?:\.\/)+/g,'/').toLowerCase();
 if(path.split('/').includes('..'))return '';
 const at=path.search(/[*?]/);
 if(at<0)return path.replace(/\/$/,'');
 const slash=path.lastIndexOf('/',at);
 return slash<0?'':path.slice(0,slash);
};
// Compares the directories every match lies under ('' = anywhere), not the
// globs themselves: it may call two resources overlapping when no path matches
// both, which only serializes their tasks, and it never misses a shared path.
export function resourcesOverlap(a:string,b:string){
 const [x,y]=[matchRoot(a),matchRoot(b)];
 return x===''||y===''||x===y||x.startsWith(y+'/')||y.startsWith(x+'/');
}
export const resourceSetsOverlap=(a:string[],b:string[])=>a.some(r=>b.some(s=>resourcesOverlap(r,s)));
