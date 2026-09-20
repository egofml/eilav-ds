const test=require('node:test'),assert=require('node:assert/strict'),B=require('../dist/batch-review.js'),Pool=require('../dist/key-pool.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('four project requests overlap; same-project keys are deduplicated and lock is retained',async()=>{
 const pool=new Pool();for(let i=0;i<4;i++)pool.add('key'+i,'project-'+i,'fake'+i);pool.add('duplicate project','project-0','fake-other');assert.equal(pool.workerProjects().length,4);
 let active=0,peak=0;await Promise.all(pool.workerProjects().map(p=>pool.executeProject(p,async()=>{active++;peak=Math.max(peak,active);assert(pool.busy);await assert.rejects(()=>pool.executeProject(p,()=>{}),/이미/);await sleep(10);active--;return 'ok';})));
 assert.equal(peak,4);assert.equal(pool.busy,false);assert.equal(pool.summary().reduce((n,k)=>n+k.usage.requests,0),4);
});
test('3000 items complete once with out-of-order responses and single malformed item isolated',async()=>{
 const items=Array.from({length:3000},(_,id)=>({id})),seen=new Set();let active=0,peak=0,failed=[],progress;
 const result=await B.parallel({items,workers:['a','b','c','d'],delay:0,wait:async()=>{},request:async(batch,worker)=>{active++;peak=Math.max(peak,active);await sleep(worker==='a'?2:1);active--;if(batch.some(x=>x.id===241))throw Object.assign(Error('bad'),{code:'AI_FORMAT'});return batch;},apply:batch=>{for(const x of batch){assert(!seen.has(x.id));seen.add(x.id);}},onFailure:x=>failed.push(x.id),progress:(done,total,failed)=>progress={done,total,failed}});
 assert.equal(peak,4);assert.equal(result.completed,2999);assert.equal(result.failed,1);assert.equal(result.remaining,0);assert.deepEqual(failed,[241]);assert.equal(progress.done+progress.failed,3000);
});
test('late quota failure hands work to idle surviving worker; all failures preserve remaining count',async()=>{
 const items=Array.from({length:25},(_,id)=>({id})),seen=[];
 const result=await B.parallel({items,workers:['quota','ready'],delay:0,request:async(batch,w)=>{if(w==='quota'){await sleep(15);throw Object.assign(Error('quota'),{status:429});}return batch;},apply:b=>seen.push(...b.map(x=>x.id))});
 assert.equal(result.completed,25);assert.equal(new Set(seen).size,25);assert.equal(result.errors.length,1);
 const stopped=await B.parallel({items,workers:['a','b'],request:async()=>{throw Object.assign(Error('denied'),{status:403});},apply:()=>assert.fail()});assert(stopped.stopped);assert.equal(stopped.remaining,25);
});
test('stop waits for all in-flight results and dispatches no extra batches',async()=>{
 let stop=false,calls=0,applied=0;const result=await B.parallel({items:Array.from({length:200},(_,id)=>({id})),workers:['a','b','c','d'],delay:0,stopped:()=>stop,request:async b=>{calls++;await sleep(5);stop=true;return b;},apply:b=>applied+=b.length});assert.equal(calls,4);assert.equal(applied,80);assert.equal(result.completed,80);assert.equal(result.remaining,120);assert(result.stopped);
});
