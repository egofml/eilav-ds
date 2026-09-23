const test=require('node:test'),assert=require('node:assert/strict'),Pool=require('../dist/key-pool.js');
function setup(){
 let clock=200000;const pool=new Pool();
 for(const name of ['slow','fast','spare'])pool.add(name,'project-'+name,'fake-'+name);
 const dispatch=pool.createDispatch();
 const sample=(name,durationMs,lastAt=clock)=>{dispatch.used.add('project-'+name);dispatch.stats.set('project-'+name,{durationMs,lastAt});};
 sample('slow',40000);sample('fast',1000);
 return {pool,dispatch,sample,now:()=>clock,advance:ms=>{clock+=ms;},rotate:extra=>pool.rotateSlow(dispatch,{etaSeconds:3601,elapsedMs:30000,now:clock,...extra})};
}
test('ETA rotation requires a measured long estimate and respects the one-minute cooldown',()=>{
 const {pool,dispatch,rotate,advance}=setup();
 for(const input of [{etaSeconds:3600},{etaSeconds:0},{etaSeconds:null},{etaSeconds:NaN},{elapsedMs:29999}])assert.equal(rotate(input),null);
 assert.deepEqual(rotate(),{from:'project-slow',to:'project-spare'});
 assert.equal(dispatch.deferred.get('project-slow'),500000);
 assert.equal(dispatch.preferred,'project-spare');assert.equal(dispatch.lastRotationAt,200000);
 advance(61000);assert.equal(rotate(),null,'pending replacement must be assigned before another rotation');
 dispatch.preferred=null;dispatch.lastRotationAt=260000;
 assert.equal(rotate(),null,'one second after the prior rotation is too early');
});
test('rotation considers request duration plus adaptive pacing and prefers an unused spare',()=>{
 const {pool,dispatch,sample,rotate}=setup();
 sample('slow',1000);sample('fast',30000);
 pool.adaptivePacing.set('project-slow',{floor:4500,paceMs:60000,successes:0});
 assert.deepEqual(rotate(),{from:'project-slow',to:'project-spare'});
 assert(!dispatch.retired.has('project-slow'),'slow service is deferred, not a quota failure');
 assert.equal(dispatch.strikes.size,0);
});
test('rotation ignores stale idle measurements but can rotate a currently running slow project',()=>{
 const {pool,dispatch,sample,rotate}=setup();
 sample('slow',40000,1);sample('fast',1000,1);
 assert.equal(rotate(),null);
 pool.runningProjects.add('project-slow');
 assert.deepEqual(rotate(),{from:'project-slow',to:'project-spare'});
 assert(pool.runningProjects.has('project-slow'),'in-flight work is not cancelled');
});
test('same-project duplicate keys are not alternative capacity',()=>{
 const pool=new Pool();pool.add('one','project-one','fake-one');pool.add('two','project-one','fake-two');
 const dispatch=pool.createDispatch();dispatch.used.add('project-one');dispatch.stats.set('project-one',{durationMs:90000,lastAt:200000});
 assert.equal(pool.rotateSlow(dispatch,{etaSeconds:7200,elapsedMs:60000,now:200000}),null);
});
test('rotation cannot choose an invalid, busy, quota-blocked, retired, paced or deferred spare',()=>{
 const exclusions=[
  (p,d)=>p.keys.filter(k=>k.project!=='project-slow').forEach(k=>k.status='invalid'),
  (p,d)=>['fast','spare'].forEach(n=>p.runningProjects.add('project-'+n)),
  (p,d)=>{p.projects.set('project-fast',{kind:'daily',retryAt:0});p.projects.set('project-spare',{kind:'unavailable',retryAt:0});},
  (p,d)=>['fast','spare'].forEach(n=>d.retired.add('project-'+n)),
  (p,d)=>['fast','spare'].forEach(n=>p.projects.set('project-'+n,{kind:'temporary',retryAt:260000})),
  (p,d)=>['fast','spare'].forEach(n=>p.nextRequest.set('project-'+n,260000)),
  (p,d)=>['fast','spare'].forEach(n=>d.deferred.set('project-'+n,260000))
 ];
 for(const exclude of exclusions){const {pool,dispatch,rotate}=setup();exclude(pool,dispatch);assert.equal(rotate(),null);assert.equal(dispatch.lastRotationAt,null);}
});
test('a previously used but ready project can be the replacement when no unused spare exists',()=>{
 const {pool,dispatch,sample,rotate}=setup();sample('spare',500);pool.keys.find(k=>k.project==='project-fast').status='invalid';
 assert.deepEqual(rotate(),{from:'project-slow',to:'project-spare'});
});
test('dispatch chooses a ready project instead of waiting behind an earlier project pacing deadline',async()=>{
 const {pool,dispatch,now,advance}=setup();pool.nextRequest.set('project-slow',now()+60000);let waits=0;
 const value=await pool.executeAny(async(key,project)=>project,{dispatch,now,wait:async ms=>{waits++;advance(ms);}});
 assert.equal(value,'project-fast');assert.equal(waits,0);
});
test('dispatch consumes the preferred replacement, records timing, and leaves in-flight work intact',async()=>{
 const {pool,dispatch,rotate,now,advance}=setup();pool.runningProjects.add('project-slow');pool.busy=true;
 assert.deepEqual(rotate(),{from:'project-slow',to:'project-spare'});
 const value=await pool.executeAny(async(key,project)=>{assert.equal(project,'project-spare');assert(dispatch.used.has(project));advance(2300);return 'ok';},{dispatch,now,wait:async ms=>advance(ms)});
 assert.equal(value,'ok');assert.equal(dispatch.preferred,null);
 assert.deepEqual(dispatch.stats.get('project-spare'),{durationMs:2300,lastAt:now()});
 assert(pool.runningProjects.has('project-slow'));assert(!pool.runningProjects.has('project-spare'));
});
test('dispatch records failed request duration without hiding non-quota errors',async()=>{
 const {pool,dispatch,now,advance}=setup();
 await assert.rejects(()=>pool.executeAny(async()=>{advance(1900);throw Error('response invalid');},{dispatch,now,wait:async ms=>advance(ms)}),/response invalid/);
 assert.deepEqual(dispatch.stats.get('project-slow'),{durationMs:1900,lastAt:now()});assert.equal(pool.runningProjects.size,0);
});
test('a preferred replacement never overrides its provider cooldown',async()=>{
 const {pool,dispatch,rotate,now,advance}=setup();rotate();pool.nextRequest.set('project-spare',now()+60000);let waits=0;
 const value=await pool.executeAny(async(key,project)=>project,{dispatch,now,wait:async ms=>{waits++;advance(ms);}});
 assert.equal(value,'project-fast');assert.equal(waits,0);assert.equal(dispatch.preferred,'project-spare');
});
