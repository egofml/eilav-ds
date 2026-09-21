(function(root){'use strict';
const VERSION='review-v2-spacing',TTL=30*86400000,MAX=10000;
function identity(item,context){return JSON.stringify([VERSION,context,item.code||'',item.original||item.title,item.title,item.sourceKeywords||'',item.candidates,item.brand||'',item.category||'']);}
function reusable(result){return Array.isArray(result?.keywords)&&result.keywords.length>0&&!result.keywords.some(c=>/^AI (후보|분류|위치|공백)/.test(c.reason||''));}
class Cache{
 constructor(records=[],now=Date.now){this.now=now;this.records=new Map(records.filter(r=>r&&typeof r.key==='string'&&Number.isFinite(r.at)&&now()-r.at<TTL&&r.at<=now()).map(r=>[r.key,r]));}
 get(item,context,G){const record=this.records.get(identity(item,context));if(!record||this.now()-record.at>=TTL)return null;try{if(!reusable(record.result))return null;return G.validateResult([{...record.result,id:item.id}],[item])[0];}catch{return null;}}
 put(item,context,result){if(!reusable(result))return;const key=identity(item,context);this.records.delete(key);this.records.set(key,{key,at:this.now(),result:{keywords:result.keywords,spacingTitle:result.spacingTitle}});while(this.records.size>MAX)this.records.delete(this.records.keys().next().value);}
}
function storage(indexedDB){let connection;const db=()=>connection||(connection=new Promise((resolve,reject)=>{const r=indexedDB.open('eilav-review-cache-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('results');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}));
 return {async read(){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('results','readonly'),r=tx.objectStore('results').get('cache');tx.oncomplete=()=>resolve(r.result||[]);tx.onerror=()=>reject(tx.error);});},async write(records){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('results','readwrite');tx.objectStore('results').put(records,'cache');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}};
}
const api={Cache,storage,identity,reusable};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DSReviewCache=api;
})(typeof window==='undefined'?globalThis:window);
