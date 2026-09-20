(function(root){'use strict';
function pending(rows){return rows.filter(r=>!r.blank&&r.candidates.length&&!r.candidates.every(k=>r.keywordChecks.some(c=>c.keyword===k)));}
async function run({items,request,apply,stopped=()=>false,valid=()=>true,progress=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delay=1500}){
 let completed=0;
 for(let start=0;start<items.length;start+=20){
  if(!valid())throw Error('표나 규칙이 변경되어 검토를 중지했습니다.');
  if(stopped())return {completed,stopped:true};
  const batch=items.slice(start,start+20);progress(completed,items.length);
  const result=await request(batch);
  if(!valid())throw Error('검토 중 표나 규칙이 변경되어 현재 응답은 적용하지 않았습니다.');
  apply(result);completed+=batch.length;progress(completed,items.length);
  if(stopped())return {completed,stopped:true};
  if(completed<items.length)await wait(delay);
 }
 return {completed,stopped:false};
}
const api={pending,run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DSBatch=api;
})(typeof window==='undefined'?globalThis:window);
