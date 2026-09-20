(function(root){'use strict';
function pending(rows){return rows.filter(r=>!r.blank&&!['held','approved'].includes(r.status)&&!r.exclusion?.length&&r.candidates.length&&!r.candidates.every(k=>r.keywordChecks.some(c=>c.keyword===k)));}
async function run({items,request,apply,stopped=()=>false,valid=()=>true,progress=()=>{},onRetry=()=>{},onFailure=()=>{},onTransient=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),delay=1500,batchSize=20}){
 if(![10,20,40].includes(batchSize))throw Error('묶음 크기를 확인해주세요.');let completed=0,failed=0;const retries=new Map();const queue=[];for(let i=0;i<items.length;i+=batchSize)queue.push(items.slice(i,i+batchSize));
 for(let index=0;index<queue.length;index++){
  if(!valid())throw Error('표나 규칙이 변경되어 검토를 중지했습니다.');
  if(stopped())return {completed,failed,stopped:true};
  const batch=queue[index];progress(completed,items.length,failed);
  let result;try{result=await request(batch);}catch(e){if(e.code==='AI_TRANSIENT'||[500,502,503,504].includes(e.status)){const attempt=(retries.get(batch)||0)+1;if(attempt<=2){retries.set(batch,attempt);if(!valid())throw Error('표가 변경되었습니다.');if(stopped())return{completed,failed,stopped:true};onTransient(attempt);await wait(attempt*2000);index--;continue;}throw e;}if(!['AI_FORMAT','AI_ITEM'].includes(e.code))throw e;if(!valid())throw Error('표나 규칙이 변경되어 검토를 중지했습니다.');if(stopped())return{completed,failed,stopped:true};if(batch.length===1){onFailure(batch[0],e);failed++;progress(completed,items.length,failed);if(index<queue.length-1)await wait(delay);continue;}const size=batch.length>5?5:1;const smaller=[];for(let i=0;i<batch.length;i+=size)smaller.push(batch.slice(i,i+size));queue.splice(index,1,...smaller);index--;onRetry(batch.length,size);await wait(delay);continue;}

  if(!valid())throw Error('검토 중 표나 규칙이 변경되어 현재 응답은 적용하지 않았습니다.');
  apply(result);completed+=batch.length;progress(completed,items.length,failed);
  if(stopped())return {completed,failed,stopped:true};
  if(index<queue.length-1)await wait(delay);
 }
 return {completed,failed,stopped:false};
}
const api={pending,run};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DSBatch=api;
})(typeof window==='undefined'?globalThis:window);
