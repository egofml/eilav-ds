const test=require('node:test'),assert=require('node:assert/strict'),Pool=require('../dist/key-pool.js'),Batch=require('../dist/batch-review.js');
function setup(){const pool=new Pool();for(const n of ['one','two','three'])pool.add(n,'project-'+n,'fake-'+n);return {pool,dispatch:pool.createDispatch()};}
const failure=fields=>Object.assign(Error('temporary server failure'),fields);

test('model discovery network and timeout errors enter the same transient handoff path',async()=>{
 const G=require('../dist/gemini.js');
 for(const failure of [new TypeError('fetch failed'),Object.assign(Error('timeout'),{name:'AbortError'})]){
  await assert.rejects(()=>G.resolveModel({key:'fake',fetcher:async()=>{throw failure;}}),e=>e.code==='AI_TRANSIENT');
 }
});
test('transient and 500/502/503/504 errors retire the failed project and hand the same batch to the next',async()=>{
 for(const fields of [{code:'AI_TRANSIENT'},...[500,502,503,504].map(status=>({status}))]){
  const {pool,dispatch}=setup(),batch=[{id:1},{id:2}],calls=[];
  const request=async(key,project)=>{calls.push({project,batch});if(project==='project-one')throw failure(fields);return batch;};
  assert.equal(await pool.executeAny(request,{dispatch}),batch);
  assert.deepEqual(calls.map(c=>c.project),['project-one','project-two']);assert(calls.every(c=>c.batch===batch));
  assert(dispatch.retired.has('project-one'));
  assert.equal(await pool.executeAny(async(key,p)=>p,{dispatch}),'project-two');
  assert.equal(pool.keys[0].status,'ready','run-local retirement must not invalidate the API key');
 }
});
test('exhausted transient projects produce a non-transient terminal error without batch-layer retries',async()=>{
 const {pool,dispatch}=setup(),calls=[];let retryCount=0;
 await assert.rejects(()=>Batch.run({items:[{id:1}],batchSize:10,delay:0,
  request:()=>pool.executeAny(async(key,project)=>{calls.push(project);throw failure({status:503,code:'AI_TRANSIENT'});},{dispatch}),
  apply:()=>assert.fail('failed batch must not apply'),onTransient:()=>retryCount++,wait:async()=>{}
 }),error=>{assert.match(error.message,/이번 실행에서 사용할 수 있는 프로젝트가 없습니다/);assert.equal(error.code,undefined);assert.equal(error.status,undefined);return true;});
 assert.deepEqual(calls,['project-one','project-two','project-three']);assert.equal(retryCount,0);assert.equal(pool.runningProjects.size,0);
});
test('fallback disabled preserves the original transient failure and does not retire or switch projects',async()=>{
 const {pool,dispatch}=setup(),error=failure({status:503,code:'AI_TRANSIENT'}),calls=[];
 await assert.rejects(()=>pool.executeAny(async(key,p)=>{calls.push(p);throw error;},{dispatch,fallback:false}),e=>e===error);
 assert.deepEqual(calls,['project-one']);assert.equal(dispatch.retired.size,0);
});
test('AI format and item errors leave the project available for batch splitting',async()=>{
 for(const code of ['AI_FORMAT','AI_ITEM']){
  const {pool,dispatch}=setup(),error=failure({code});
  await assert.rejects(()=>pool.executeAny(async()=>{throw error;},{dispatch}),e=>e===error);
  assert.equal(dispatch.retired.size,0);assert.equal(await pool.executeAny(async(key,p)=>p,{dispatch}),'project-one');
 }
});
test('concurrent handoff preserves one request per project and applies every product exactly once',async()=>{
 const {pool,dispatch}=setup(),active=new Set(),calls=new Map(),applied=new Set();let peak=0;
 const outcome=await Batch.parallel({items:Array.from({length:40},(_,id)=>({id})),workers:['a','b','c','d'],batchSize:10,delay:0,
  request:batch=>pool.executeAny(async(key,project)=>{
   assert(!active.has(project));active.add(project);peak=Math.max(peak,active.size);calls.set(project,(calls.get(project)||0)+1);
   try{await new Promise(r=>setTimeout(r,1));if(project==='project-one')throw failure({status:503});return batch;}finally{active.delete(project);}
  },{dispatch,wait:()=>new Promise(r=>setTimeout(r,1))}),
  apply:batch=>{for(const item of batch){assert(!applied.has(item.id));applied.add(item.id);}}
 });
 assert.equal(outcome.completed,40);assert.equal(outcome.remaining,0);assert.equal(calls.get('project-one'),1);assert.equal(applied.size,40);assert(peak<=3);assert.equal(pool.runningProjects.size,0);
});
test('a fresh dispatch can use a transient-retired project again',async()=>{
 const {pool,dispatch}=setup();await pool.executeAny(async(key,p)=>{if(p==='project-one')throw failure({status:502});return p;},{dispatch});
 assert(dispatch.retired.has('project-one'));const next=pool.createDispatch();assert.equal(next.retired.size,0);
 assert.equal(await pool.executeAny(async(key,p)=>p,{dispatch:next}),'project-one');
});
