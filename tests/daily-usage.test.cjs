const test=require('node:test'),assert=require('node:assert/strict'),Pool=require('../dist/key-pool.js');
const storage=()=>({setItem(k,v){this.value=v;},getItem(){return this.value;},removeItem(){this.value=null;}});
test('Pacific reset includes daylight saving transitions and exact boundaries',()=>{
 for(const [at,start,end] of [
 ['2026-09-23T06:59:59.999Z','2026-09-22T07:00:00Z','2026-09-23T07:00:00Z'],
 ['2026-09-23T07:00:00Z','2026-09-23T07:00:00Z','2026-09-24T07:00:00Z'],
 ['2026-01-23T10:00:00Z','2026-01-23T08:00:00Z','2026-01-24T08:00:00Z'],
 ['2026-03-08T12:00:00Z','2026-03-08T08:00:00Z','2026-03-09T07:00:00Z'],
 ['2026-11-01T12:00:00Z','2026-11-01T07:00:00Z','2026-11-02T08:00:00Z']]){
  const p=new Pool({now:()=>Date.parse(at)});assert.equal(p.usagePeriod().start,Date.parse(start));assert.equal(p.usagePeriod().end,Date.parse(end));
 }
});
test('daily counts roll over without changing keys, quota or cumulative run counters',async()=>{
 let clock=Date.parse('2026-09-23T06:59:59Z');const p=new Pool({now:()=>clock});const id=p.add('a','project-a','fake');
 await p.test(id,async()=>{p.recordUsage('fake',{promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:15});});
 p.projects.set('project-a',{retryAt:clock+60000,kind:'daily'});
 assert.equal(p.summary()[0].dailyUsage.total,15);clock+=1000;
 const row=p.summary()[0];assert.equal(row.dailyUsage.requests,0);assert.equal(row.dailyUsage.total,0);assert.equal(row.usage.total,15);assert.equal(row.status,'quota');assert.equal(p.keys[0].key,'fake');
 p.recordUsage('fake',{totalTokenCount:4});assert.equal(p.summary()[0].dailyUsage.responses,1);assert.equal(p.summary()[0].dailyUsage.requests,0);assert.equal(p.summary()[0].usage.total,19);
});
test('all request paths count daily, including failed attempts; restore same/new/legacy periods',async()=>{
 let clock=Date.parse('2026-09-23T10:00:00Z');const p=new Pool({now:()=>clock});p.add('a','project-a','fake');
 await p.execute(async()=>1);await p.executeProject('project-a',async()=>1);await assert.rejects(()=>p.test(1,async()=>{throw Error('network');}));
 assert.equal(p.summary()[0].dailyUsage.requests,3);
 const s=storage();p.save(s);const restored=new Pool({now:()=>clock});restored.restore(s);assert.equal(restored.summary()[0].dailyUsage.requests,3);
 clock+=86400000;const later=new Pool({now:()=>clock});later.restore(s);assert.equal(later.summary()[0].dailyUsage.requests,0);assert.equal(later.summary()[0].usage.requests,3);
 const old=JSON.parse(s.value);delete old.keys[0].dailyUsage;delete old.keys[0].usageDay;s.value=JSON.stringify(old);
 const legacy=new Pool({now:()=>clock});legacy.restore(s);assert.equal(legacy.summary()[0].dailyUsage.requests,0);assert.equal(legacy.summary()[0].usage.requests,3);
});
