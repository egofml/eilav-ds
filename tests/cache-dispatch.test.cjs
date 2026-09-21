const test=require('node:test'),assert=require('node:assert/strict'),{Cache}=require('../dist/review-cache.js'),G=require('../dist/gemini.js'),Pool=require('../dist/key-pool.js'),B=require('../dist/batch-review.js');
const item={id:1,code:'001',title:'주방 바구니',original:'주방 바구니',candidates:['정리용'],brand:'브랜드',category:'수납',sourceKeywords:'정리용'};
const result={id:1,keywords:[{keyword:'정리용',status:'no_obvious_issue',reason:'용도',afterWord:1}]};
test('reuses exact conditions on a new row ID and expires, never reuses malformed or changed input',()=>{
 let now=1;const c=new Cache([],()=>now);c.put(item,'rules',result);
 assert.equal(c.get({...item,id:500},'rules',G).id,500);
 for(const changed of [{code:'002'},{title:'주방  바구니'},{original:'다른원본'},{brand:'다름'},{category:'다름'},{candidates:['다용도']},{sourceKeywords:'정리용,새후보'}])assert.equal(c.get({...item,...changed},'rules',G),null);
 assert.equal(c.get(item,'new-rules',G),null);
 const restored=new Cache(JSON.parse(JSON.stringify([...c.records.values()])),()=>now);assert(restored.get(item,'rules',G));
 now+=31*86400000;assert.equal(restored.get(item,'rules',G),null);
 const bad=new Cache();bad.put(item,'rules',{...result,keywords:[{...result.keywords[0],reason:'AI 위치 오류로 삽입 제외',status:'uncertain',afterWord:null}]});assert.equal(bad.records.size,0);
 bad.put(item,'rules',{...result,keywords:[{...result.keywords[0],afterWord:99}]});assert.equal(bad.get(item,'rules',G),null);
});
test('all ten registered projects join on quota failures; concurrency stays at four with no duplicates',async()=>{
 const pool=new Pool();for(let i=0;i<10;i++)pool.add('test','project-'+i,'fake-'+i);
 const dispatch=pool.createDispatch(),used=new Set(),seen=new Set();let active=0,peak=0;
 const outcome=await B.parallel({items:Array.from({length:200},(_,id)=>({id})),workers:['1','2','3','4'],batchSize:20,delay:0,
 request:batch=>pool.executeAny(async(key,project)=>{used.add(project);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;if(Number(project.split('-')[1])<6)throw Object.assign(Error('daily'),{status:429,quotaKind:'daily'});return batch;},{dispatch,wait:()=>new Promise(r=>setTimeout(r,1))}),
 apply:batch=>{for(const r of batch){assert(!seen.has(r.id));seen.add(r.id);}}});
 assert.equal(outcome.completed,200);assert.equal(used.size,10);assert(peak<=4);assert.equal(seen.size,200);
});
test('temporary cooldown yields immediately to unused ready project, and all failures terminate',async()=>{
 const pool=new Pool();pool.add('one','project-one','one');pool.add('two','project-two','two');
 const used=[];let waits=0;const value=await pool.executeAny(async(key,p)=>{used.push(p);if(key==='one')throw Object.assign(Error('minute'),{status:429,quotaKind:'temporary'});return 42;},{wait:async()=>{waits++;}});
 assert.equal(value,42);assert.deepEqual(used,['project-one','project-two']);assert.equal(waits,0);
 const fail=new Pool();fail.add('one','project-one','one');let clock=0,calls=0;
 await assert.rejects(()=>fail.executeAny(async()=>{calls++;throw Object.assign(Error('unknown'),{status:429});},{now:()=>clock,wait:async ms=>{clock+=ms;}}),/사용할 수/);
 assert.equal(calls,2);assert(!fail.busy);
});
