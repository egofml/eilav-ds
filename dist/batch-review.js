(function(root){'use strict';
function pending(rows){return rows.filter(r=>!r.blank&&r.candidates.length&&!r.candidates.every(k=>r.keywordChecks.some(c=>c.keyword===k)));}
async function run({items,request,apply,stopped=()=>false,valid=()=>true,progress=()=>{},onRetry=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delay=1500}){
 let completed=0;const queue=[];for(let i=0;i<items.length;i+=20)queue.push(items.slice(i,i+20));
 for(let index=0;index<queue.length;index++){
  if(!valid())throw Error('표나 규칙이 변경되어 검토를 중지했습니다.');
  if(stopped())return {completed,stopped:true};
  const batch=queue[index];progress(completed,items.length);
  let result;try{result=await request(batch);}catch(e){if(e.code!=='AI_FORMAT'||batch.length<=5)throw e;if(!valid())throw Error('표나 규칙이 변경되어 검토를 중지했습니다.');if(stopped())return{completed,stopped:true};const smaller=[];for(let i=0;i<batch.length;i+=5)smaller.push(batch.slice(i,i+5));queue.splice(index,1,...smaller);index--;onRetry(batch.length);await wait(delay);continue;}
  if(!valid())throw Error('검토 중 표나 규칙이 변경되어 현재 응답은 적용하지 않았습니다.');
  apply(result);completed+=batch.length;progress(completed,items.length);
  if(stopped())return {completed,stopped:true};
  if(completed<items.length)await wait(delay);
 }
 return {completed,stopped:false};
}
const api={pending,run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DSBatch=api;
})(typeof window==='undefined'?globalThis:window);
