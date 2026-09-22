const test=require('node:test'),assert=require('node:assert/strict'),Pool=require('../dist/key-pool.js');
const quota=(kind='temporary',retryAfterMs=30000)=>Object.assign(Error('quota'),{status:429,quotaKind:kind,retryAfterMs});
function setup(){let clock=0;const p=new Pool(),labels=[];p.add('a','project-a','fake-a');p.add('b','project-b','fake-b');return {p,labels,now:()=>clock,config:{adaptive:true,quotaRetries:0,now:()=>clock,wait:async ms=>{clock+=ms;},onWait:s=>labels.push(s)}};}
test('adaptive spacing doubles only the throttled project and caps at one minute',async()=>{
 const {p,config,now}=setup();
 for(const expected of [9000,18000,36000,60000,60000]){
  const before=now();await assert.rejects(()=>p.executeProject('project-a',async()=>{throw quota();},config));
  assert.equal(p.summary()[0].paceMs,expected);assert.equal(p.projects.get('project-a').retryAt,now()+61000);assert(now()>=before);
 }
 await p.executeProject('project-b',async()=>true,config);
 assert.equal(p.summary()[1].paceMs,4500);assert.equal(p.summary()[0].paceMs,60000);
});
test('adaptive spacing preserves RetryAfter cooldown and recovers after five successes',async()=>{
 const {p,config,now,labels}=setup();
 await assert.rejects(()=>p.executeProject('project-a',async()=>{throw quota('unknown',120000);},config));
 assert.equal(p.projects.get('project-a').retryAt,121000);
 await p.executeProject('project-a',async()=>true,config);assert.equal(now(),121000);
 const before=now();await p.executeProject('project-a',async()=>true,config);assert.equal(now()-before,9000);assert(labels.some(s=>s.startsWith('자동 감속')));
 for(let i=0;i<3;i++)await p.executeProject('project-a',async()=>true,config);
 assert.equal(p.summary()[0].paceMs,4500);
 for(let i=0;i<5;i++)await p.executeProject('project-a',async()=>true,config);
 assert.equal(p.summary()[0].paceMs,4500);
});
test('daily and unavailable quotas never auto retry even with explicit retry count',async()=>{
 for(const kind of ['daily','unavailable']){
  const {p,config}=setup();let calls=0;
  await assert.rejects(()=>p.executeProject('project-a',async()=>{calls++;throw quota(kind);},{...config,quotaRetries:3}));
  assert.equal(calls,1);assert.equal(p.summary()[0].paceMs,4500);
 }
});
test('adaptive pacing is opt-in and is not persisted with keys',async()=>{
 const {p,config,now}=setup();
 await p.executeProject('project-a',async()=>true,{...config,adaptive:false});
 await p.executeProject('project-a',async()=>true,{...config,adaptive:false});assert.equal(now(),0);
 await assert.rejects(()=>p.executeProject('project-a',async()=>{throw quota();},config));
 const storage={setItem(k,v){this.value=v;},getItem(){return this.value;}};p.save(storage);
 const restored=new Pool();restored.restore(storage);assert.equal(restored.summary()[0].paceMs,undefined);
 assert.equal(restored.summary()[0].quotaKind,'temporary');
});
test('dispatch passes adaptive pacing through while limiting retries and preserving project ownership',async()=>{
 const {p,config}=setup();let attempts=0;const starts=[];
 assert.equal(await p.executeAny(async(key,project)=>{starts.push(project);assert(p.runningProjects.has(project));if(!attempts++)throw quota();return 'ok';},config),'ok');
 assert.deepEqual(starts,['project-a','project-b']);assert.equal(p.summary()[0].paceMs,9000);assert.equal(p.summary()[1].paceMs,4500);assert.equal(p.runningProjects.size,0);
});
