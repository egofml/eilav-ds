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
async function parallel(options){
 const {items,workers,request,apply,onFailure=()=>{},progress=()=>{},onWorker=()=>{},fallback=true,stopped=()=>false,valid=()=>true,batchSize=20,delay=1500,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}=options;
 if(!Array.isArray(workers)||!workers.length||workers.length>4||new Set(workers).size!==workers.length||![10,20,40].includes(batchSize))throw Error('병렬 작업자 설정을 확인해주세요.');
 const queue=[];for(let i=0;i<items.length;i+=batchSize)queue.push(items.slice(i,i+batchSize));
 const settled=new Set();let completed=0,failed=0,halt=false,inFlight=0;const errors=[],waiters=[];const wake=()=>{for(const resolve of waiters.splice(0))resolve();};
 const report=()=>progress(completed,items.length,failed);
 await Promise.all(workers.map(async worker=>{
  while(!halt&&!stopped()&&valid()){
   if(!queue.length){if(!inFlight)break;await new Promise(resolve=>waiters.push(resolve));continue;}
   const batch=queue.shift();inFlight++;onWorker(worker,'검토 중 · '+batch.length+'개');
   try{await run({...options,items:batch,wait,stopped:()=>halt||stopped(),request:b=>request(b,worker),
    apply:results=>{const fresh=results.filter(r=>!settled.has(r.id));apply(fresh);for(const r of fresh)settled.add(r.id);completed+=fresh.length;report();},
    onFailure:(item,e)=>{if(!settled.has(item.id)){onFailure(item,e);settled.add(item.id);failed++;report();}},progress:()=>{}});
   }catch(e){errors.push({worker,message:e.message});onWorker(worker,'중지 · '+e.message);const remaining=batch.filter(x=>!settled.has(x.id));if(remaining.length)queue.unshift(remaining);if(!fallback||!valid())halt=true;return;}finally{inFlight--;wake();}
   onWorker(worker,'대기');if(queue.length&&!halt&&!stopped())await wait(delay);
  }
  onWorker(worker,'완료 또는 대기 종료');
 }));
 if(!valid())throw Error('표나 규칙이 변경되어 병렬 검토를 중지했습니다.');
 return {completed,failed,remaining:items.length-settled.size,stopped:stopped()||halt||settled.size<items.length,userStopped:!!stopped(),errors};
}
const api={pending,run,parallel};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DSBatch=api;
})(typeof window==='undefined'?globalThis:window);
