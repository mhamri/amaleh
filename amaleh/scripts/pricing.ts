export type CatalogPricing={prompt?:string;completion?:string;request?:string;input_cache_read?:string;input_cache_write?:string};
export type PriceBook=(model:string,at:string)=>CatalogPricing|undefined;
export type TokenUsage={inputTokens:number;outputTokens:number;cacheRead:number;cacheWrite:number};

const perToken=(value:unknown)=>{if(typeof value!=='string'&&typeof value!=='number')return undefined;const n=Number(value);return value!==''&&Number.isFinite(n)&&n>=0?n:undefined;};

// See references/runtime.md#diagnostic-traces
export function catalogCost(pricing:CatalogPricing|undefined,turns:TokenUsage[]):number|undefined{
 const prompt=perToken(pricing?.prompt),completion=perToken(pricing?.completion);
 if(prompt===undefined||completion===undefined)return undefined;
 const cacheRead=perToken(pricing?.input_cache_read)??prompt,cacheWrite=perToken(pricing?.input_cache_write)??prompt,request=perToken(pricing?.request)??0;
 return turns.reduce((total,u)=>total+u.inputTokens*prompt+u.cacheRead*cacheRead+u.cacheWrite*cacheWrite+u.outputTokens*completion+request,0);
}

export function priceBook(quotes:{at:string;model:string;pricing:CatalogPricing}[]):PriceBook{
 const byModel=new Map<string,{at:string;pricing:CatalogPricing}[]>();
 for(const q of [...quotes].sort((a,b)=>a.at.localeCompare(b.at))){const list=byModel.get(q.model)??[];list.push(q);byModel.set(q.model,list);}
 return (model,at)=>{const list=byModel.get(model);if(!list)return undefined;return (list.findLast(q=>q.at<=at)??list[0]).pricing;};
}
