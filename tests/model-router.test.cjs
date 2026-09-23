const test=require('node:test'),assert=require('node:assert/strict'),Router=require('../dist/model-router.js');
const A='gemini-3.5-flash-lite',B='gemini-2.5-flash-lite',C='gemini-2.0-flash-lite',D='gemini-1.5-flash-lite';
const http=status=>Object.assign(Error('server failure'),{status});
const args={key:'fake-private-key',project:'p'};
function setup(models=[A,B]){let at=10000,calls=0;const stored=new Map(),events=[];const storage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};const router=new Router({listModels:async()=>{calls++;return models;},now:()=>at,storage,onStatus:event=>events.push(event)});return {router,stored,events,storage,advance:ms=>{at+=ms;},calls:()=>calls,now:()=>at};}
test('503 switches models once per API call and skips the failed model across projects',async()=>{
 const {router,events}=setup();let requests=0;const seen=[];
 await assert.rejects(router.execute({...args,onModel:model=>seen.push(model),request:async()=>{requests++;throw http(503);}}),error=>error.code==='AI_MODEL_SWITCH'&&error.nextModel===B&&error.status===undefined);
 assert.equal(requests,1);assert.deepEqual(seen,[A]);assert.equal(events[0].nextModel,B);
 assert.equal(await router.resolve({...args,project:'other'}),B);
 assert.equal(await router.execute({...args,request:async model=>{requests++;return model;}}),B);assert.equal(requests,2);
});
test('at most three distinct generation models per project per run',async()=>{
 const {router,advance}=setup([A,B,C,D]);let calls=0;
 for(let i=0;i<3;i++)await assert.rejects(router.execute({...args,request:async()=>{calls++;throw http(503);}}),error=>error.code===(i<2?'AI_MODEL_SWITCH':'AI_MODELS_UNAVAILABLE'));
 await assert.rejects(router.execute({...args,request:async()=>{calls++;}}),{code:'AI_MODELS_UNAVAILABLE'});assert.equal(calls,3);
 advance(900001);assert.equal(await router.resolve(args),A,'expired preferred model is eligible without a fourth distinct ID');
 router.beginRun();assert.equal(await router.resolve(args),A);
});
test('manual selection does not list models, switch or globally block failures',async()=>{
 const {router,calls,stored}=setup();const error=http(503);
 await assert.rejects(router.execute({...args,automatic:false,model:'manual-model',request:async model=>{assert.equal(model,'manual-model');throw error;}}),value=>value===error);
 assert.equal(calls(),0);assert.equal(stored.size,0);assert.equal(await router.resolve(args),A);
});
test('quota, permissions, malformed output and network timeouts never trigger model switching',async()=>{
 const {router,stored}=setup();
 for(const error of [http(429),http(403),http(400),Object.assign(Error('timeout'),{code:'AI_TRANSIENT'}),Object.assign(Error('format'),{code:'AI_FORMAT'})]){
  await assert.rejects(router.execute({...args,request:async()=>{throw error;}}),value=>value===error);
  assert.equal(await router.resolve(args),A);
 }assert.equal(stored.size,0);
});
test('stable text models only; Lite availability forbids more expensive Flash fallback',async()=>{
 const {router}=setup(['gemini-3.5-pro','gemini-3.5-flash-preview','gemini-3.5-flash-image',A,'gemini-2.5-flash']);
 assert.equal(await router.resolve(args),A);
 await assert.rejects(router.execute({...args,request:async()=>{throw http(503);}}),{code:'AI_MODELS_UNAVAILABLE'});
 const flash=new Router({listModels:async()=>['gemini-2.5-flash']});assert.equal(await flash.resolve(args),'gemini-2.5-flash');
});
test('health persists without key/project, survives beginRun and expires after 15 minutes',async()=>{
 const env=setup();await assert.rejects(env.router.execute({...args,request:async()=>{throw http(503);}}),{code:'AI_MODEL_SWITCH'});
 const saved=[...env.stored.values()][0];assert(!saved.includes(args.key));assert(!saved.includes('"project"'));
 env.router.beginRun();assert.equal(await env.router.resolve(args),B);
 const next=new Router({listModels:async()=>[A,B],storage:env.storage,now:env.now});assert.equal(await next.resolve(args),B);
 env.advance(900000);assert.equal(await next.resolve(args),A);
});
test('unsafe and far-future persisted health entries cannot disable models indefinitely',async()=>{
 const storage={getItem:()=>JSON.stringify({version:1,blocked:[{model:A,until:900001},{model:'__proto__',until:800000},{model:B,until:'800000'}]}),setItem:()=>{}};
 const router=new Router({listModels:async()=>[A,B],storage,now:()=>0});assert.equal(await router.resolve(args),A);
 const broken=new Router({listModels:async()=>[A],storage:{getItem:()=>'{',setItem:()=>{throw Error('denied');}}});
 await assert.rejects(broken.execute({...args,request:async()=>{throw http(503);}}),{code:'AI_MODELS_UNAVAILABLE'});
});
test('supported model listing is coalesced per project and refreshed next run',async()=>{
 const {router,calls}=setup();await Promise.all([router.resolve(args),router.resolve(args)]);assert.equal(calls(),1);
 await router.resolve({...args,project:'other'});assert.equal(calls(),2);router.beginRun();await router.resolve(args);assert.equal(calls(),3);
 let attempts=0;const retry=new Router({listModels:async()=>{if(++attempts===1)throw http(503);return [A];}});
 await assert.rejects(retry.resolve(args),{status:503});assert.equal(await retry.resolve(args),A);assert.equal(attempts,2);
});
test('all globally blocked models stop other projects without generation or key cycling',async()=>{
 const {router}=setup([A]);let calls=0;await assert.rejects(router.execute({...args,request:async()=>{calls++;throw http(503);}}),{code:'AI_MODELS_UNAVAILABLE'});
 await assert.rejects(router.execute({...args,project:'other',request:async()=>{calls++;}}),{code:'AI_MODELS_UNAVAILABLE'});assert.equal(calls,1);
});
test('late successful inflight request does not clear another request model failure',async()=>{
 const {router}=setup();let finish;const running=router.execute({...args,project:'other',request:()=>new Promise(resolve=>{finish=resolve;})});
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(router.execute({...args,request:async()=>{throw http(503);}}),{code:'AI_MODEL_SWITCH'});
 finish('valid result');assert.equal(await running,'valid result');assert.equal(await router.resolve({...args,project:'third'}),B);
});
