const test=require('node:test'),assert=require('node:assert/strict');
const Router=require('../dist/model-router.js'),Pool=require('../dist/key-pool.js'),Batch=require('../dist/batch-review.js');
const A='gemini-3.5-flash-lite',B='gemini-2.5-flash-lite';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(projectCount=10,models=[A,B]){
 let clock=100000,waits=0;
 const now=()=>clock,wait=async ms=>{assert(++waits<2000,'request dispatch must settle in bounded time');clock+=ms;await tick();};
 const pool=new Pool({now});for(let i=0;i<projectCount;i++)pool.add('test '+i,'project-'+i,'fake-'+i);
 pool.add('same project other key','project-0','fake-duplicate');
 const dispatch=pool.createDispatch(),router=new Router({listModels:async()=>models,now}),events=[];
 const run=(request,items=Array.from({length:200},(_,id)=>({id})))=>Batch.parallel({items,workers:['one','two','three','four'],delay:0,wait,
  request:batch=>pool.executeAny((key,project)=>router.execute({key,project,request:model=>request({batch,model,project,at:now()})}),{dispatch,now,wait,adaptive:true,paceMs:4500,onProject:(project,state)=>events.push({project,state})}),
  apply:batch=>applied.push(...batch.map(item=>item.id))});
 const applied=[];return {pool,router,dispatch,run,applied,events,now,wait};
}
test('parallel common-model 503 recovers on another model with no duplicate rows or retired keys',async()=>{
 const env=setup();let active=0,peak=0;const projects=new Set(),calls=[];
 const result=await env.run(async call=>{
  assert(!projects.has(call.project),'one active request per project including duplicate keys');projects.add(call.project);active++;peak=Math.max(peak,active);calls.push(call);
  try{await tick();if(call.model===A)throw Object.assign(Error('overloaded'),{status:503});return call.batch;}
  finally{projects.delete(call.project);active--;}
 });
 assert.equal(result.completed,200);assert.equal(result.remaining,0);assert.equal(result.stopped,false);assert.equal(result.errors.length,0);
 assert.equal(env.applied.length,200);assert.equal(new Set(env.applied).size,200);assert.equal(peak,4);
 assert(calls.filter(call=>call.model===A).length<=5,'confirmation permits a second failure before globally blocking');
 assert(calls.some(call=>call.model===B));assert.equal(env.dispatch.retired.size,0);assert.equal(env.pool.projects.size,0);
 assert(env.pool.summary().every(key=>key.status==='ready'));
 for(const project of new Set(calls.map(call=>call.project))){const starts=calls.filter(call=>call.project===project).map(call=>call.at);for(let i=1;i<starts.length;i++)assert(starts[i]-starts[i-1]>=4500,'model switch preserves project start spacing');}
});
test('same-project fallback waits the normal 4.5 second interval before a second model request',async()=>{
 const env=setup(1),calls=[];
 const result=await env.run(async call=>{calls.push(call);await tick();if(call.model===A)throw Object.assign(Error('overloaded'),{status:503});return call.batch;},Array.from({length:20},(_,id)=>({id})));
 assert.equal(result.completed,20);assert.deepEqual(calls.map(call=>call.model),[A,B]);assert(calls[1].at-calls[0].at>=4500);assert.equal(env.dispatch.retired.size,0);
});
test('all model failures terminate a parallel run finitely and preserve every unprocessed row',async()=>{
 const env=setup();let calls=0;
 const result=await env.run(async()=>{assert(++calls<=20,'each project/model pair is attempted at most once');await tick();throw Object.assign(Error('overloaded'),{status:503});});
 assert.equal(result.completed,0);assert.equal(result.remaining,200);assert.equal(result.stopped,true);assert.equal(env.applied.length,0);
 assert.equal(env.dispatch.retired.size,10,'only this run is exhausted');assert(env.pool.summary().every(k=>k.status==='ready'),'keys are not persistently invalidated');assert.equal(env.pool.projects.size,0);
 assert(result.errors.length>0);assert(result.errors.every(error=>/모델/.test(error.message)));assert.equal(env.pool.busy,false);
});
test('429 is handled as a project quota failure without changing or globally blocking the model',async()=>{
 const env=setup(2),calls=[];
 const result=await env.run(async call=>{calls.push(call);await tick();if(call.project==='project-0')throw Object.assign(Error('daily quota'),{status:429,quotaKind:'daily'});return call.batch;},Array.from({length:40},(_,id)=>({id})));
 assert.equal(result.completed,40);assert.equal(new Set(env.applied).size,40);assert(calls.every(call=>call.model===A));
 assert.equal(env.router.blocked.size,0);assert.equal(env.pool.projects.get('project-0').kind,'daily');assert(env.dispatch.retired.has('project-0'));assert(!env.dispatch.retired.has('project-1'));
});

test('one exhausted project hands work to healthy projects instead of losing the worker',async()=>{
 const env=setup(6),calls=[];
 const result=await env.run(async call=>{calls.push(call);await tick();if(call.project==='project-0')throw Object.assign(Error('project service failure'),{status:503});return call.batch;});
 assert.equal(result.completed,200);assert.equal(result.stopped,false);assert.equal(new Set(env.applied).size,200);
 assert(env.dispatch.retired.has('project-0'));assert.equal(env.dispatch.retired.size,1);
 assert.deepEqual(calls.filter(c=>c.project==='project-0').map(c=>c.model),[A,B]);
 assert.equal(env.router.blocked.size,0);assert(calls.some(c=>c.project!=='project-0'&&c.model===A));
});
