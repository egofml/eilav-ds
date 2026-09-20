const test=require('node:test'),assert=require('node:assert/strict'),G=require('../dist/gemini.js'),Pool=require('../dist/key-pool.js');
const error=(kind='temporary')=>Object.assign(Error('quota'),{status:429,quotaKind:kind,retryAfterMs:30413});
test('Google quota metadata distinguishes minute, daily, zero and parses RetryInfo',async()=>{
 for(const [id,value,kind] of [['GenerateRequestsPerMinutePerProjectPerModel-FreeTier',15,'temporary'],['GenerateRequestsPerDayPerProjectPerModel-FreeTier',15,'daily'],['GenerateRequestsPerMinute',0,'unavailable'],['',15,'unknown']]){
  await assert.rejects(()=>G.check({key:'fake',model:'gemini-3.5-flash-lite',items:[{id:0,title:'a',candidates:['b']}],fetcher:async()=>({ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{message:'quota',details:[{violations:[{quotaId:id,quotaValue:String(value)}]},{retryDelay:'30.413s'}]}})})}),e=>e.quotaKind===kind&&e.retryAfterMs===30413);
 }
});
test('temporary quota waits then resumes same project; pacing covers subsequent requests',async()=>{
 const p=new Pool();p.add('a','project-a','fake');let clock=0,calls=0,waited=0;
 const config={now:()=>clock,paceMs:4500,wait:async ms=>{clock+=ms;waited+=ms;}};
 assert.equal(await p.executeProject('project-a',async()=>{if(!calls++)throw error();return 'ok';},config),'ok');
 assert.equal(calls,2);assert(waited>=61000);assert.equal(p.summary()[0].status,'ready');
 const before=clock;await p.executeProject('project-a',async()=>1,config);assert.equal(clock-before,4500);
});
test('daily quota is not retried; unknown retries once; waiting stop sends no new request',async()=>{
 for(const kind of ['daily','unavailable','unknown','temporary']){
  const p=new Pool();p.add('a','project-a','fake');let calls=0;
  await assert.rejects(()=>p.executeProject('project-a',async()=>{calls++;throw error(kind);},{wait:async()=>{}}));
  assert.equal(calls,{daily:1,unavailable:1,unknown:2,temporary:4}[kind]);assert(!p.busy);
 }
 const p=new Pool();p.add('a','project-a','fake');let stop=false,calls=0;
 await assert.rejects(()=>p.executeProject('project-a',async()=>{calls++;throw error();},{stopped:()=>stop,wait:async()=>{stop=true;}}),/중지/);
 assert.equal(calls,1);assert(!p.busy);
});
test('legacy quota states become retry candidates without losing usage or keys',async()=>{
 const p=new Pool();p.add('a','project-a','fake');p.projects.set('project-a',{retryAt:0});p.keys[0].usage.total=123;
 const store={setItem(k,v){this.v=v},getItem(){return this.v}};p.save(store);const next=new Pool();next.restore(store);
 assert.deepEqual(next.workerProjects(),['project-a']);assert.equal(next.summary()[0].usage.total,123);
 await next.executeProject('project-a',async()=>true);assert.equal(next.summary()[0].status,'ready');
});
