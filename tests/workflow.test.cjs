const test=require('node:test'),assert=require('node:assert/strict');
const DS=require('../dist/core.js'),G=require('../dist/gemini.js'),B=require('../dist/batch-review.js'),S=require('../dist/work-session.js');
const options={terms:['최고'],shipping:500,returns:500,includeZero:false,position:'ai',keywordCount:2};
function fixture(n){return DS.stringify([DS.HEADERS,...Array.from({length:n},(_,i)=>DS.HEADERS.map(h=>({'상품코드':'00'+i,'상품명':i===2?'모형 만 14세 이상':'최고 주방 수납 바구니','키워드':'정리용','배송비':i%2?'0':'3000','반품배송비':'6000','가격':'1234'}[h]||'')))]);}
function result(items){return items.map(x=>({id:x.id,keywords:x.candidates.map(keyword=>({keyword,status:'no_obvious_issue',reason:'용도',afterWord:1}))}));}
test('3000 products: requests, isolated malformed item, stop, durable restore, resume, approve, 13-column export',async()=>{
 const source=fixture(3000),table=DS.tableFrom(source);let rows=DS.analyze(table,options),stop=false;
 const items=()=>B.pending(rows).map(r=>({id:r.index,title:r.cleaned,candidates:r.candidates}));
 const apply=out=>{for(const r of out)rows[r.id]=DS.applyKeywordReview(rows[r.id],r.keywords,'ai');};
 await B.run({items:items(),request:async b=>{stop=true;return result(b);},apply,stopped:()=>stop,wait:async()=>{}});
 assert.equal(B.pending(rows).length,2979);
 const saved=JSON.parse(JSON.stringify(S.encode({source,options,rows})));assert(!JSON.stringify(saved).includes('apiKey'));
 const restored=S.decode(saved,DS,G);rows=restored.rows;assert.equal(B.pending(rows).length,2979);assert.equal(rows[0].output[19],'3500');
 let lastProgress;const outcome=await B.run({items:items(),request:async b=>G.check({key:'fake',model:'gemini-test',items:b,fetcher:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:b.some(x=>x.id===241)?'[]':JSON.stringify(result(b))}]}}]})})}),apply,onFailure:(item,e)=>{rows[item.id].aiError=e.message;},progress:(done,total,failed)=>lastProgress={done,total,failed},wait:async()=>{}});
 assert.equal(outcome.failed,1);assert.equal(outcome.completed,2978);assert.equal(lastProgress.done+lastProgress.failed,lastProgress.total);
 for(let i=0;i<rows.length;i++){const r=rows[i];if(r.status==='pending'&&r.keywordChecks.length===r.candidates.length)rows[i]=DS.approve(r,r.proposed,'',options.terms);}
 const block=DS.exportBlock(table,rows);assert.equal(block.length,3000);assert(block.every(r=>r.length===13));assert.equal(block[241][0],'주방 수납 바구니');assert.equal(block[0][0],'주방 정리용 수납 바구니');assert.equal(block[0][1],'1234');assert.equal(block[1][11],'0');assert.equal(block[2][0],'모형 만 14세 이상');
 assert.deepEqual(DS.exportBlock(table,S.decode(S.encode({source,options,rows}),DS,G).rows),block);
});
test('transient retries bounded, quota not retried, stop during retry sends no more requests',async()=>{
 let calls=0,waits=[];await B.run({items:[{id:1}],request:async b=>{if(++calls<3)throw Object.assign(Error('temporary'),{status:503});return b;},apply:()=>{},wait:async n=>waits.push(n)});assert.equal(calls,3);assert.deepEqual(waits,[2000,4000]);
 calls=0;await assert.rejects(()=>B.run({items:[{}],request:async()=>{calls++;throw Object.assign(Error('quota'),{status:429});},apply:()=>{},wait:async()=>{}}),/quota/);assert.equal(calls,1);
 calls=0;let stop=false;const out=await B.run({items:[{}],request:async()=>{calls++;throw Object.assign(Error(),{code:'AI_TRANSIENT'});},apply:()=>assert.fail(),stopped:()=>stop,wait:async()=>{stop=true;}});assert(out.stopped);assert.equal(calls,1);
});
test('corrupt checkpoint rejects unknown IDs and never trusts stored output; manual decisions stay out of pending',()=>{
 const source=fixture(4),rows=DS.analyze(DS.tableFrom(source),options);rows[0]=DS.approve(rows[0],rows[0].cleaned,'',options.terms);rows[1].status='held';assert.equal(B.pending(rows).length,1);
 const data=S.encode({source,options,rows});data.edits[3].checks=[{keyword:'invented',status:'no_obvious_issue',reason:'',afterWord:1}];assert.throws(()=>S.decode(data,DS,G),/후보/);
});
