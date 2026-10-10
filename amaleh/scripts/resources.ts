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
const normalized=(resource:string)=>resource.replace(/\\/g,'/').replace(/\/{2,}/g,'/').replace(/^(?:\.\/)+/,'').replace(/\/(?:\.\/)+/g,'/').replace(/(.)\/$/,'$1').toLowerCase();
const escapesUp=(path:string)=>path.split('/').includes('..');
const matchRoot=(path:string)=>{
 if(escapesUp(path))return '';
 const at=path.search(/[*?]/);
 if(at<0)return path;
 const slash=path.lastIndexOf('/',at);
 return slash<0?'':path.slice(0,slash);
};
// A literal owns its whole subtree, but a glob without '**' matches only paths of its
// own depth, so it cannot reach below a literal at least that deep that it does not match.
const globMissesLiteral=(glob:string,literal:string)=>!glob.includes('**')&&literal.split('/').length>=glob.split('/').length&&!globToRegExp(glob).test(literal);
// Two globs are compared by the directories their matches lie under ('' =
// anywhere): that may call them overlapping when no path matches both, which only
// serializes their tasks, and it never misses a shared path.
export function resourcesOverlap(a:string,b:string){
 const [p,q]=[normalized(a),normalized(b)],[x,y]=[matchRoot(p),matchRoot(q)];
 if(!(x===''||y===''||x===y||x.startsWith(y+'/')||y.startsWith(x+'/')))return false;
 if(p==='*'||q==='*'||escapesUp(p)||escapesUp(q))return true;
 if(wildcard(p)&&!wildcard(q))return !globMissesLiteral(p,q);
 if(wildcard(q)&&!wildcard(p))return !globMissesLiteral(q,p);
 return true;
}
export const resourceSetsOverlap=(a:string[],b:string[])=>a.some(r=>b.some(s=>resourcesOverlap(r,s)));
