const test=require('node:test'),assert=require('node:assert/strict'),Pool=require('../dist/key-pool.js');
function pool(){const p=new Pool();for(const n of ['one','two','three'])p.add(n,'project-'+n,'fake-'+n);p.add('same','project-one','fake-duplicate');return p;}
test('run shuffle is per unique project, reproducible with injected randomness and never changes saved key order',async()=>{
 const p=pool(),before=p.keys.map(k=>k.id),a=p.createDispatch({randomize:true,random:()=>0}),b=p.createDispatch({randomize:true,random:()=>0.999});
 assert.deepEqual([...a.order.keys()],['project-two','project-three','project-one']);assert.deepEqual([...b.order.keys()],['project-one','project-two','project-three']);assert.deepEqual(p.keys.map(k=>k.id),before);
 assert.equal(await p.executeAny(async(k,project)=>project,{dispatch:a}),'project-two');
 assert.equal(await p.executeAny(async(k,project)=>project,{dispatch:b}),'project-one');
});
test('shuffle never overrides cooldown, retirement, daily exhaustion or explicit slow-key replacement',async()=>{
 const p=pool(),dispatch=p.createDispatch({randomize:true,random:()=>0});
 p.projects.set('project-two',{kind:'temporary',retryAt:5000});
 assert.equal(await p.executeAny(async(k,project)=>project,{dispatch,now:()=>1000}),'project-three');
 dispatch.preferred='project-one';assert.equal(await p.executeAny(async(k,project)=>project,{dispatch,now:()=>1000}),'project-one');
 dispatch.retired.add('project-one');p.projects.set('project-two',{kind:'daily',retryAt:0});
 assert.equal(await p.executeAny(async(k,project)=>project,{dispatch,now:()=>1000}),'project-three');
});
test('parallel shuffled dispatch reserves projects exactly once including duplicate keys',async()=>{
 const p=pool(),dispatch=p.createDispatch({randomize:true,random:()=>0}),started=[],releases=[];
 const calls=Array.from({length:3},()=>p.executeAny(async(k,project)=>{started.push(project);await new Promise(r=>releases.push(r));return project;},{dispatch}));
 await new Promise(r=>setImmediate(r));assert.deepEqual(started,['project-two','project-three','project-one']);assert.equal(new Set(started).size,3);releases.forEach(r=>r());await Promise.all(calls);assert.equal(p.runningProjects.size,0);
});
