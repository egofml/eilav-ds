const test=require('node:test'),assert=require('node:assert/strict'),DS=require('../dist/core.js'),Batch=require('../dist/batch-review.js');
test('age exclusion runs before forbidden removal and retains original aligned row',()=>{
 const headers=['상품코드','상품명','키워드','배송비','반품배송비','상세정보'];
 const source=[['001','장난감 (만 14세 이상 사용)','정리용','3000','6000',''],['002','수납함','정리용','3000','6000',''],['003','모형','취미용','0','6000','<p>만 １４ 세&nbsp;이상</p>']];
 const table=DS.tableFrom(DS.stringify([headers,...source])),rows=DS.analyze(table,{terms:['14세','장난감'],shipping:500,returns:500,position:'ai'});
 assert.equal(rows[0].status,'excluded');assert.deepEqual(rows[0].output,source[0]);assert.equal(rows[2].status,'excluded');assert.equal(Batch.pending(rows).length,1);
 assert.deepEqual(DS.exportRows(table,rows)[0],source[0]);assert.equal(DS.exportRows(table,rows).length,3);assert.equal(DS.exportRows(table,rows.filter(r=>!r.exclusion?.length)).length,1);
 assert.throws(()=>DS.approve(rows[0],'모형','',[]),/제외/);
 assert.deepEqual(DS.exclusionReasons({names:['상품명']},['114세 이상']),[]);
});
test('40-item batches preserve order and isolated format failure does not stop later products',async()=>{
 const items=Array.from({length:43},(_,id)=>({id})),seen=[],failed=[],sizes=[];
 const result=await Batch.run({items,batchSize:40,request:async b=>{sizes.push(b.length);if(b.some(x=>x.id===7))throw Object.assign(Error('invalid position'),{code:'AI_FORMAT'});return b;},apply:b=>seen.push(...b.map(x=>x.id)),onFailure:x=>failed.push(x.id),wait:async()=>{}});
 assert.equal(sizes[0],40);assert.equal(result.completed,42);assert.equal(result.failed,1);assert.deepEqual(failed,[7]);assert.deepEqual(seen,items.filter(x=>x.id!==7).map(x=>x.id));
});
